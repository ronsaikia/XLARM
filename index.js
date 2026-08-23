const { execSync, exec, spawn } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const fs = require('fs');
const http = require('http');
const Groq = require('groq-sdk');
require('dotenv/config');

// --- ADD THIS RIGHT AFTER YOUR EXISTING require(...) LINES, BEFORE ANYTHING ELSE ---
// Without these, an uncaught error anywhere (e.g. inside the mpv/yt-dlp
// stdout handler, or a rejected promise from the Groq/transcription calls)
// kills the ENTIRE Node process silently - including the HTTP server on
// port 5000. That's consistent with what you're seeing: the Uno Q gets
// "Connection refused" for the whole test, meaning nothing is listening on
// port 5000 anymore, even though it clearly was at startup.
process.on('uncaughtException', (err) => {
    console.error('\n🔥 UNCAUGHT EXCEPTION - process would have died silently without this handler:');
    console.error(err);
    // Deliberately NOT calling process.exit() here so the HTTP server on
    // port 5000 stays alive and you can see what actually broke.
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('\n🔥 UNHANDLED PROMISE REJECTION - would have crashed the process:');
    console.error(reason);
});
// --- END ADDITION ---
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const AUDIO_IN = '/dev/shm/input.wav';
const AUDIO_OUT = '/dev/shm/reply.mp3';

// --- NON-BLOCKING AUDIO RECORDING ---
// This replaces the old execSync() call. execSync() freezes Node's entire
// single-threaded event loop until the command finishes (i.e. until you stop
// speaking), which meant the HTTP server on port 5000 could not accept any
// incoming connections from the Uno Q while it was recording - even though
// server.listen(5000, ...) had already run. spawn() runs the command in the
// background and just notifies us with an event when it's done, so the event
// loop - and therefore the HTTP server - stays alive and responsive the
// entire time.
function recordAudio() {
    return new Promise((resolve, reject) => {
        const cmd = `arecord -q -D plughw:1,0 -f S16_LE -r 16000 -c 1 -t wav | sox -q -t wav - -t wav ${AUDIO_IN} silence 1 0.1 5% 1 1.2 5%`;
        const child = spawn(cmd, { shell: true });

        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`arecord/sox exited with code ${code}`));
            }
        });

        child.on('error', (err) => {
            reject(err);
        });
    });
}

// --- PI COMMAND & FEEDBACK SERVER ---
let pendingCommand = null;
let visionResolve = null;

const server = http.createServer((req, res) => {
    if (req.url === '/api/poll' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (pendingCommand) {
            res.end(JSON.stringify({ has_command: true, command: pendingCommand }));
            pendingCommand = null;
        } else {
            res.end(JSON.stringify({ has_command: false }));
        }
    }
    else if (req.url === '/api/feedback' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                console.log("\nRECEIVED VISION FEEDBACK FROM UNO Q:", data);
                if (visionResolve) {
                    visionResolve(data);
                    visionResolve = null;
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
    } else {
        res.writeHead(404);
        res.end();
    }
});

server.listen(5000, '0.0.0.0', () => {
    console.log("Pi Command Server listening on port 5000 (with Feedback Hook)...");
});

let chatHistory = [
    {
        role: 'system',
        content: 'You are XLR, a highly advanced home AI assistant for a robotics lab. You were created by two geniuses, MD Mehtab Hussain and Chiranjib Saikia. Speak normally like a human being, be a mate. Keep your answers STRICTLY to 1 or 2 short sentences. You have access to a robotic arm, home automation relays, and a vision system. When you use the vision tool, rely strictly on the data returned by the tool response.\n\nCRITICAL RULE FOR MUSIC: If the user asks you to play a song, check if they specified the name. If NOT, ask them what to play. DO NOT call a tool. If they DID specify a name, output a queue_uno_q_command tool call with subsystem "music", action "play", and target as the song name.\n\nCRITICAL RULE FOR LIGHTS: If the user asks to turn on/off the lights, use action "turn_on" or "turn_off". If they ask to change the color, use action "set_color", target "led_ring", and set the value EXACTLY as the 8-bit RGB values formatted as "R,G,B" (e.g., "255,0,0" for red, "0,255,255" for cyan).'
    }
];

// --- MUSIC STREAMING WITH AUTOMATIC RETRY ---
// yt-dlp occasionally hits a transient 403 from YouTube even with a working
// JS runtime (deno) and correct PATH - this has been confirmed by testing
// the identical command manually right after a Node-triggered failure and
// having it succeed instantly. Rather than chase an intermittent, external
// cause further, this retries automatically up to 3 total attempts, 1.5s
// apart, before giving up. The arm-sync trigger logic (matching the
// 'A: 00:00:01'/'A: 00:00:02' timestamp lines to set pendingCommand) is
// completely unchanged from before - it's just now inside a function that
// can call itself again on failure.
// --- MUSIC STREAMING WITH AUTOMATIC RETRY ---
function launchMusicStream(searchQuery, targetLabel, attemptsLeft = 3) {
    
    // --- NEW: Fixes the 403 Forbidden by passing the exact Node.js path to solve the YouTube JS challenge ---
    let mpvCmd = `/usr/local/bin/yt-dlp -f "bestaudio" -q -o - "scsearch1:${searchQuery}" | mpv --no-video --ao=alsa -`;
    const child = exec(mpvCmd + " &");

    let isMusicPlaying = false;
    let sawError = false;

    const handleAudioLog = (data) => {
        const lines = data.toString().split('\n');
        for (let line of lines) {
            line = line.trim();
            if (line.length > 0) {
                // Prints exactly the way you requested
                console.log(`[Music]: ${line}`);

                if (line.includes('403') || line.includes('unable to download video data')) {
                    sawError = true;
                }

                // BULLETPROOF SYNC: Arm only dances when actual audio playback hits 1 second!
                if (!isMusicPlaying && (line.includes('A: 00:00:01') || line.includes('A: 00:00:02'))) {
                    isMusicPlaying = true;
                    pendingCommand = { subsystem: 'music', action: 'play', target: targetLabel };
                }
            }
        }
    };

    child.stdout.on('data', handleAudioLog);
    child.stderr.on('data', handleAudioLog);

    child.on('close', () => {
        if (!isMusicPlaying && sawError && attemptsLeft > 1) {
            console.log(`[Music] Attempt failed, retrying... (${attemptsLeft - 1} attempt(s) left)`);
            setTimeout(() => {
                launchMusicStream(searchQuery, targetLabel, attemptsLeft - 1);
            }, 1500);
        } else {
            pendingCommand = { subsystem: 'music', action: 'stop', target: 'all' };
        }
    });
}

async function liveAssistant() {
    console.log("LIVE AI INITIATED. I am always listening...");

    while (true) {
        try {
            console.log("\nListening... (Speak now, stops when you pause)");
            await recordAudio();
	    // --- NEW: Prevent 'Audio file is too short' crash ---
            const audioStats = fs.statSync(AUDIO_IN);
            if (audioStats.size < 1000) {
                continue; // File is essentially empty (just silence), skip to the next loop safely.
            }

            process.stdout.write("Transcribing... ");
            const transcription = await groq.audio.transcriptions.create({
                file: fs.createReadStream(AUDIO_IN),
                model: 'whisper-large-v3-turbo',
            });
            const userText = transcription.text;

            if (!userText || userText.trim().length < 2) continue;

            console.log(`\nYou: "${userText}"`);
            chatHistory.push({ role: 'user', content: userText });

            process.stdout.write("Thinking... ");

            const response = await groq.chat.completions.create({
                model: 'openai/gpt-oss-120b',
                messages: chatHistory,
                tools: [
                    {
                        type: "function",
                        function: {
                            name: "queue_uno_q_command",
                            description: "Delegates a physical task to the Arduino UNO Q. Use this to control the robotic arm, trigger OpenCV vision scans, or change home automation relays and LEDs.",
                            parameters: {
                                type: "object",
                                properties: {
                                    subsystem: { type: "string", enum: ["arm", "vision", "automation", "games", "music"] },
                                    action: {
                                        type: "string",
                                        enum: ["scan", "play", "stop", "animate", "set_joint", "turn_on", "turn_off", "set_color", "pick"],
                                        description: "The strict action to perform. set_joint is a calibration-only test command: target must be one of base/shoulder/elbow/wrist_pitch/wrist_roll, and value must be an angle in degrees (20-160). For set_color, value MUST be RGB like '255,0,0'."
                                    },
                                    target: { type: "string" },
                                    value: { type: "string" }
                                },
                                required: ["subsystem", "action", "target"]
                            }
                        }
                    }
                ],
                tool_choice: "auto"
            });

            const responseMsg = response.choices[0]?.message;
            let replyText = responseMsg.content;

            if (responseMsg.tool_calls) {
                for (const toolCall of responseMsg.tool_calls) {
                    if (toolCall.function.name === 'queue_uno_q_command') {
                        const args = JSON.parse(toolCall.function.arguments);
                        console.log(`\nQUEUING COMMAND FOR UNO Q -> Subsystem: [${args.subsystem}] Action: [${args.action}] Target: [${args.target}]`);

                        chatHistory.push(responseMsg);

                        if (args.subsystem === 'vision') {
                            pendingCommand = args;
                            console.log("Vision scan requested. Pausing AI to wait for camera feed from Arduino...");

                            const visionPromise = new Promise((resolve) => {
                                visionResolve = resolve;
                                setTimeout(() => {
                                    if (visionResolve === resolve) {
                                        visionResolve = null;
                                        resolve({ status: 'timeout', detections: {} });
                                    }
                                }, 4000);
                            });

                            const visionResult = await visionPromise;
                            console.log("Vision data received from Arduino:", visionResult);

                            chatHistory.push({
                                role: 'tool',
                                tool_call_id: toolCall.id,
                                content: `Live Camera Scan Results: ${JSON.stringify(visionResult)}`
                            });

			} else if (args.subsystem === 'arm' && args.action === 'pick') {
                            console.log(`Locating ${args.target} for pick sequence...`);
                            
                            // Placeholder coordinates (in reality, you'd pull this from the visionResult dictionary)
                            let objPixelX = 320; 
                            let objPixelY = 240;

                            try {
                                const ikResult = execSync(`python3 arm_ik.py ${objPixelX} ${objPixelY}`).toString();
                                const sequenceData = JSON.parse(ikResult);
                                
                                if (sequenceData.status === "success") {
                                    console.log(`Executing ${sequenceData.sequence.length}-step pick sequence!`);
                                    chatHistory.push({
                                        role: 'tool',
                                        tool_call_id: toolCall.id,
                                        content: `Successfully calculated kinematics and executed pick sequence for ${args.target}.`
                                    });

                                    // Queue the frames to the Arduino
                                    for (let frame of sequenceData.sequence) {
                                        let poseStr = frame.pose.join(",");
                                        // Sends: arm:set_pose:all:90,110,45,90,90,180
                                        pendingCommand = { subsystem: 'arm', action: 'set_pose', target: 'all', value: poseStr };
                                        // In a real execution, you would await frame.delay here before queuing the next.
                                    }
                                }
                            } catch (err) {
                                console.error("IK Calculation Failed", err);
                            }

                        // ---------------------------------------------------------
                        // THE MUSIC ENGINE (PERFECT SYNC)
                        // ---------------------------------------------------------
                        } else if (args.subsystem === 'music') {
                            if (args.action === 'stop') {
                                console.log("Stopping music...");
                                exec('killall mpv');
                                pendingCommand = { subsystem: 'music', action: 'stop', target: 'all' };
                                chatHistory.push({
                                    role: 'tool',
                                    tool_call_id: toolCall.id,
                                    content: `Successfully stopped the music.`
                                });
                            } else {
                                console.log(`XLR is streaming audio for: ${args.target}`);
                                chatHistory.push({
                                    role: 'tool',
                                    tool_call_id: toolCall.id,
                                    content: `Successfully started playing ${args.target}.`
                                });

                                let searchQuery = args.target.replace(/"/g, '');
                                launchMusicStream(searchQuery, args.target);
                            }

                        } else {
                            pendingCommand = args;
                            console.log("Command queued!");
                            chatHistory.push({
                                role: 'tool',
                                tool_call_id: toolCall.id,
                                content: `Successfully queued ${args.action} command for the UNO Q.`
                            });
                        }

                        const followup = await groq.chat.completions.create({
                            model: 'openai/gpt-oss-120b',
                            messages: [
                                ...chatHistory,
                                { role: 'system', content: 'You are the conversational voice. Summarize the data naturally. DO NOT attempt to call tools or output JSON.' }
                            ]
                        });
                        replyText = followup.choices[0]?.message?.content;
                    }
                }
            }

            if (!replyText) replyText = "Done.";
            console.log(`\nAssistant: "${replyText}"\n`);
            chatHistory.push({ role: 'assistant', content: replyText });

            if (chatHistory.length > 11) {
                 chatHistory = [chatHistory[0]].concat(chatHistory.filter(m => !m.tool_calls && m.role !== 'tool').slice(-6));
            }

            console.log("Speaking...");
            await execAsync(`edge-tts --text "${replyText}" --write-media ${AUDIO_OUT}`);
              
            // --- NEW: Tell Arduino to nod gently as speech begins ---
            pendingCommand = { subsystem: 'arm', action: 'animate', target: 'speak_start' };

            try {
                // Blocks the Pi loop until the voice finishes playing
                await execAsync(`mpg123 -q ${AUDIO_OUT}`);
            } catch(e) {}

            // --- NEW: Tell Arduino to drop limp to the table the millisecond speech ends ---
            pendingCommand = { subsystem: 'arm', action: 'animate', target: 'speak_stop' };

            if (fs.existsSync(AUDIO_IN)) fs.unlinkSync(AUDIO_IN);
            if (fs.existsSync(AUDIO_OUT)) fs.unlinkSync(AUDIO_OUT);

        } catch (error) {
            if(error.message && error.message.includes('arecord')) continue;
            console.error("\nLoop error:", error.message);
        }
    }
}

liveAssistant();
