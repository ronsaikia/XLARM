const { execSync, exec, spawn } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const fs = require('fs');
const http = require('http');
const Groq = require('groq-sdk');
require('dotenv/config');


process.on('uncaughtException', (err) => {
    console.error('\n UNCAUGHT EXCEPTION - process would have died silently without this handler:');
    console.error(err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('\n UNHANDLED PROMISE REJECTION - would have crashed the process:');
    console.error(reason);
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const AUDIO_IN = '/dev/shm/input.wav';
const AUDIO_OUT = '/dev/shm/reply.mp3';


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
        content: 'You are XLR, a highly advanced home AI assistant for a robotics lab. Speak normally like a human being, be a mate. Keep your answers STRICTLY to 1 or 2 short sentences. You have access to a robotic arm, home automation relays, and a vision system. When you use the vision tool, rely strictly on the data returned by the tool response.\n\nCRITICAL RULE FOR MUSIC: If the user asks you to play a song, check if they specified the name. If NOT, ask them what to play. DO NOT call a tool. If they DID specify a name, output a queue_uno_q_command tool call with subsystem "music", action "play", and target as the song name.\n\nCRITICAL RULE FOR LIGHTS: If the user asks to turn on/off the lights, use action "turn_on" or "turn_off". If they ask to change the color, use action "set_color", target "led_ring", and set the value EXACTLY as the 8-bit RGB values formatted as "R,G,B" (e.g., "255,0,0" for red, "0,255,255" for cyan).'
    }
];


function launchMusicStream(searchQuery, targetLabel, attemptsLeft = 3) {
    
    
    let mpvCmd = `/usr/local/bin/yt-dlp -f "bestaudio" -q -o - "scsearch1:${searchQuery}" | mpv --no-video --ao=alsa -`;
    const child = exec(mpvCmd + " &");

    let isMusicPlaying = false;
    let sawError = false;

    const handleAudioLog = (data) => {
        const lines = data.toString().split('\n');
        for (let line of lines) {
            line = line.trim();
            if (line.length > 0) {
                
                console.log(`[Music]: ${line}`);

                if (line.includes('403') || line.includes('unable to download video data')) {
                    sawError = true;
                }

                
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
	  
            const audioStats = fs.statSync(AUDIO_IN);
            if (audioStats.size < 1000) {
                continue; 
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
                                        enum: ["scan", "play", "stop", "animate", "set_joint", "turn_on", "turn_off", "set_color"],
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
              
            
            pendingCommand = { subsystem: 'arm', action: 'animate', target: 'speak_start' };

            try {
                
                await execAsync(`mpg123 -q ${AUDIO_OUT}`);
            } catch(e) {}

            
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
