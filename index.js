import 'dotenv/config'; 
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import http from 'http'; 
import axios from 'axios'; 

// 🌐 Web Server for Railway
const server = http.createServer((req, res) => {
    res.end('RV Games Ultra Bot is Online!');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🌐 Web server is running on port ${PORT}`);
});

const authFolder = './bot_session';

// 📂 Session ID Setup
function setupSession() {
    const credsPath = path.join(authFolder, 'creds.json');
    if (fs.existsSync(credsPath)) return console.log("📂 පැරණි සෙෂන් දත්ත සොයාගන්නා ලදී...");

    const sessionId = process.env.SESSION_ID;
    if (!sessionId) {
        console.error("❌ ERROR: Railway Variables වල SESSION_ID එක දමා නැත!");
        process.exit(1);
    }
    
    fs.mkdirSync(authFolder, { recursive: true });
    try {
        let base64String = sessionId;
        if (sessionId.includes(';;;')) base64String = sessionId.split(';;;').pop();
        else if (sessionId.includes('~')) base64String = sessionId.split('~').pop();
        else if (sessionId.includes(':')) base64String = sessionId.split(':').pop();

        const decrypted = Buffer.from(base64String, 'base64').toString('utf-8');
        JSON.parse(decrypted); 
        fs.writeFileSync(credsPath, decrypted);
        console.log("✅ SESSION_ID එක සාර්ථකව ක්‍රියාත්මක කරන ලදී!");
    } catch (err) {
        console.error("❌ ERROR: SESSION_ID එකේ දෝෂයක් පවතී!");
        process.exit(1); 
    }
}
setupSession();

// 📊 Progress Bar 
function getProgressBar(percent) {
    const total = 10;
    const filled = Math.round((percent / 100) * total);
    const empty = total - filled;
    return '▰'.repeat(filled) + '▱'.repeat(empty);
}

// 🗂️ Extension Generator based on MIME-Type
function getExtensionFromMime(mimeType) {
    const map = {
        'application/zip': '.zip',
        'application/x-zip-compressed': '.zip',
        'application/x-rar-compressed': '.rar',
        'application/vnd.rar': '.rar',
        'application/x-rar': '.rar',
        'application/pdf': '.pdf',
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'video/mp4': '.mp4',
        'audio/mpeg': '.mp3',
        'application/vnd.android.package-archive': '.apk',
        'text/plain': '.txt'
    };
    return map[mimeType] || '.bin';
}

// 📥 Heavy Lift Downloader & Auto Content Displayer
async function handleDownloadAndUpload(url, sock, msg, sendToJid) {
    const chatJid = msg.key.remoteJid;
    const progressMsg = await sock.sendMessage(chatJid, { text: `🔍 𝖱𝖵 𝖦𝖺𝗆𝖾𝗌 Bot ලින්ක් එක පරීක්ෂා කරමින් පවතී...` }, { quoted: msg });
    
    try {
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        let fileName = '';
        const contentDisposition = response.headers['content-disposition'];
        const contentType = response.headers['content-type'] || 'application/octet-stream';

        if (contentDisposition) {
            const utf8Match = contentDisposition.match(/filename\*=\s*UTF-8''([^;\r\n]*)/i);
            if (utf8Match && utf8Match[1]) {
                fileName = decodeURIComponent(utf8Match[1]);
            } else {
                const normalMatch = contentDisposition.match(/filename\s*=\s*["']?([^;\r\n"']*)["']?/i);
                if (normalMatch && normalMatch[1]) {
                    fileName = normalMatch[1];
                }
            }
        }

        if (!fileName) {
            try {
                const cleanUrl = url.split('?')[0].split('#')[0];
                let pathName = path.basename(cleanUrl);
                if (pathName && pathName !== '/' && !pathName.includes('%')) {
                    fileName = decodeURIComponent(pathName);
                }
            } catch (e) {}
        }

        if (fileName) {
            fileName = fileName.replace(/[/\\?%*:|"<>]/g, '-').trim(); 
        }

        if (!fileName || fileName.length > 200) {
            fileName = `RV_Games_File_${Math.floor(Math.random() * 10000)}`;
        }

        if (!fileName.includes('.')) {
            const ext = getExtensionFromMime(contentType);
            fileName += ext;
        }

        const totalLength = parseInt(response.headers['content-length'], 10) || 0;
        let downloadedLength = 0;
        let lastUpdateTime = Date.now();

        const tempFilePath = path.join('./', `${Date.now()}_${fileName}`);
        const writer = fs.createWriteStream(tempFilePath);

        // --- 1. 📥 DOWNLOADING PHASE ---
        response.data.on('data', async (chunk) => {
            downloadedLength += chunk.length;
            if (totalLength) {
                const percent = ((downloadedLength / totalLength) * 100).toFixed(1);
                const now = Date.now();
                
                if (now - lastUpdateTime > 2000) { 
                    lastUpdateTime = now;
                    const dlMB = (downloadedLength / (1024 * 1024)).toFixed(1);
                    const totMB = (totalLength / (1024 * 1024)).toFixed(1);
                    const bar = getProgressBar(percent);
                    const text = `📥 *Downloading:* ${fileName}\n📊 ${bar} ${percent}%\n📦 ${dlMB}MB / ${totMB}MB`;
                    
                    await sock.sendMessage(chatJid, { text: text, edit: progressMsg.key }).catch(() => {});
                }
            }
        });

        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        // --- 2. 📤 UPLOADING PHASE ---
        let uploadPercent = 0;
        const totalMB = (totalLength / (1024 * 1024)).toFixed(1);

        const uploadInterval = setInterval(async () => {
            if (uploadPercent < 90) {
                uploadPercent += Math.floor(Math.random() * 12) + 6; 
                if (uploadPercent > 94) uploadPercent = 94;
                
                const upMB = ((uploadPercent / 100) * totalMB).toFixed(1);
                const bar = getProgressBar(uploadPercent);
                const text = `📤 *Uploading:* ${fileName}\n📊 ${bar} ${uploadPercent.toFixed(1)}%\n📦 ${upMB}MB / ${totalMB}MB`;
                
                await sock.sendMessage(chatJid, { text: text, edit: progressMsg.key }).catch(() => {});
            }
        }, 1500);

        // 🚀 WhatsApp එකට යැවීම
        await sock.sendMessage(sendToJid, { 
            document: { url: tempFilePath }, 
            mimetype: contentType, 
            fileName: fileName,
            caption: `*𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games*`
        });
        
        clearInterval(uploadInterval);
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); 

        await sock.sendMessage(chatJid, { text: `🎉 *${fileName}* සාර්ථකව යවන ලදී!\n\n*𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games*`, edit: progressMsg.key }).catch(() => {});
        return true; // සාර්ථකයි නම් true රිටන් කරයි

    } catch (error) {
        console.error(error);
        await sock.sendMessage(chatJid, { text: `❌ දෝෂයක්: ෆයිල් එක ලබා ගැනීමට නොහැකි විය.`, edit: progressMsg.key }).catch(() => {});
        return false;
    }
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion(); 

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }), 
        browser: ['RV Games Bot', 'Chrome', '1.0.0'],
        syncFullHistory: false 
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        if (!text.startsWith('.')) return; 

        const senderJid = msg.key.participant || msg.key.remoteJid; 
        
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const urls = text.match(urlRegex) || [];

        // 1️⃣ .si Command 
        if (text.startsWith('.si ')) {
            if (urls.length === 0) return await sock.sendMessage(msg.key.remoteJid, { text: '❌ කරුණාකර වලංගු ලින්ක් එකක් ලබා දෙන්න.' }, { quoted: msg });
            for (let url of urls) {
                await handleDownloadAndUpload(url, sock, msg, senderJid);
            }
        }

        // 2️⃣ .sg Command (Group Upload + Auto End Summary Report)
        else if (text.startsWith('.sg ')) {
            if (urls.length === 0) return await sock.sendMessage(msg.key.remoteJid, { text: '❌ කරුණාකර වලංගු ලින්ක් එකක් ලබා දෙන්න.' }, { quoted: msg });

            let groupName = text.replace('.sg ', '');
            urls.forEach(u => groupName = groupName.replace(u, ''));
            groupName = groupName.trim().toLowerCase();

            if (!groupName) return await sock.sendMessage(msg.key.remoteJid, { text: '❌ කරුණාකර ගෲප් එකේ නම සඳහන් කරන්න.' }, { quoted: msg });
            const initialNotify = await sock.sendMessage(msg.key.remoteJid, { text: `🔍 '${groupName}' ගෲප් එක සොයමින් පවතී...` });

            try {
                const groups = await sock.groupFetchAllParticipating();
                let targetGroupJid = null;

                for (let jid in groups) {
                    if (groups[jid].subject.toLowerCase() === groupName) {
                        targetGroupJid = jid; break;
                    }
                }

                if (!targetGroupJid) return await sock.sendMessage(msg.key.remoteJid, { text: '❌ ඒ නමින් ගෲප් එකක් සොයාගත නොහැකි විය.' });
                
                // ⏱️ මුළු ක්‍රියාවලියටම යන වෙලාව මැනීම ආරම්භය
                const startTime = Date.now();
                let uploadedCount = 0;

                for (let url of urls) {
                    const success = await handleDownloadAndUpload(url, sock, msg, targetGroupJid);
                    if (success) uploadedCount++;
                }

                const endTime = Date.now();
                const totalTimeSeconds = ((endTime - startTime) / 1000).toFixed(1);

                // 📊 ඔයා ඉල්ලපු ලස්සන Done Summary Message එක ගෲප් එකටම යැවීම 
                if (uploadedCount > 0) {
                    const summaryText = 
                        `┏━━━━━━━━━━━━━━━━━━━━━━━┓\n` +
                        `      ⚙️ 𝚁𝚅 𝙶𝙰𝙼𝙴𝚂 ⚙️\n` +
                        `┗━━━━━━━━━━━━━━━━━━━━━━━┛\n\n` +
                        `┌────────────────────────\n` +
                        `│ ✅ Status: Done\n` +
                        `│ 📦 Total Parts: ${uploadedCount}\n` +
                        `│ ⏱️ Time Taken: ${totalTimeSeconds}s\n` +
                        `└────────────────────────\n\n` +
                        `𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games`;

                    await sock.sendMessage(targetGroupJid, { text: summaryText });
                    await sock.sendMessage(msg.key.remoteJid, { text: `✅ සියලුම Parts (${uploadedCount}) ගෲප් එකට සාර්ථකව යවා Summary වාර්තාවද ලබා දෙන ලදී!`, edit: initialNotify.key });
                }

            } catch (error) {
                await sock.sendMessage(msg.key.remoteJid, { text: '❌ ගෲප් එකට යැවීමේදී දෝෂයක් ඇති විය.' });
            }
        }

        // 3️⃣ .speed Command
        else if (text.trim() === '.speed') {
            await sock.sendMessage(msg.key.remoteJid, { text: '⚡ RV Games සර්වර් වේගය පරීක්ෂා කරමින් පවතී...' }, { quoted: msg });
            
            try {
                const pingStart = Date.now();
                await fetch('https://httpbin.org/ping');
                const pingTime = Date.now() - pingStart;

                const dlStart = Date.now();
                const dlResponse = await fetch('https://httpbin.org/bytes/1048576'); 
                const fileBuffer = await dlResponse.arrayBuffer();
                const dlEnd = Date.now();
                
                const dlDuration = (dlEnd - dlStart) / 1000;
                const downloadSpeed = (8 / dlDuration).toFixed(2);

                const ulStart = Date.now();
                await fetch('https://httpbin.org/post', { method: 'POST', body: fileBuffer });
                const ulEnd = Date.now();
                
                const ulDuration = (ulEnd - ulStart) / 1000;
                const uploadSpeed = (8 / ulDuration).toFixed(2);

                const speedText = `*⚡ RV GAMES SERVER SPEED* 🎮\n\n` +
                                  `🏓 *Ping:* \`${pingTime} ms\`\n` +
                                  `📥 *Download Speed:* \`${downloadSpeed} Mbps\`\n` +
                                  `📤 *Upload Speed:* \`${uploadSpeed} Mbps\`\n\n` +
                                  `_𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  𝚁𝚅 𝙶𝙰𝙼𝙴𝚂_`;

                await sock.sendMessage(msg.key.remoteJid, { text: speedText }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(msg.key.remoteJid, { text: '❌ Speed test දෝෂයකි.' }, { quoted: msg });
            }
        }

        // 4️⃣ .menu Command 
        else if (text.trim() === '.menu') {
            const menuText = 
                `👑 *𝚁𝚅 𝙶𝙰𝙼𝙴𝚂 𝙾𝙵𝙵𝙸𝙲𝙸𝙰𝙻 𝙱𝙾𝚃* 👑\n\n` +
                `╔════════════════════╗\n` +
                `┃   🤖 *MAIN COMMANDS MENU* \n` +
                `╚════════════════════╝\n` +
                `┃ 📥 *.si [link 1] [link 2]*\n` +
                `┃ ↳ _ලින්ක් කීපයක් වුවද එකවර Inbox එවයි._\n` +
                `┃\n` +
                `┃ 👥 *.sg [group name] [link 1] [link 2]*\n` +
                `┃ ↳ _අදාළ ගෲප් එක වෙත ෆයිල්ස් සහ Summary වාර්තාව යවයි._\n` +
                `┃\n` +
                `┃ ⚡ *.speed*\n` +
                `┃ ↳ _සර්වර් එකේ සැබෑ DL/UL වේගය මනියි._\n` +
                `┃\n` +
                `┃ 📜 *.menu*\n` +
                `┃ ↳ _මෙම විධාන මෙනුව ලබා දෙයි._\n` +
                `╚════════════════════╝\n\n` +
                `_𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  𝚁𝚅 𝙶𝙰𝙼𝙴𝚂_`;
                
            await sock.sendMessage(msg.key.remoteJid, { text: menuText }, { quoted: msg });
        }
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === DisconnectReason.loggedOut || statusCode === 405) {
                if (fs.existsSync(authFolder)) fs.rmSync(authFolder, { recursive: true, force: true });
                process.exit(1); 
            } else {
                setTimeout(() => startBot(), 5000); 
            }
        } else if (connection === 'open') {
            console.log('🎉 RV Games Bot Connected Successfully!');
        }
    });
}

startBot();
