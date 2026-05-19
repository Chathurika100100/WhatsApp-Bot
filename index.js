import 'dotenv/config'; 
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import http from 'http'; 
import axios from 'axios'; 

// 🌐 Railway Crash වීම වැළැක්වීමට ඇති Web Server එක
const server = http.createServer((req, res) => {
    res.end('RV Games WhatsApp Bot is Online!');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🌐 Web server is running on port ${PORT}`);
});

const authFolder = './bot_session';

// 📂 Session ID Setup කිරීම
function setupSession() {
    const credsPath = path.join(authFolder, 'creds.json');
    if (fs.existsSync(credsPath)) return console.log("📂 දැනටමත් පවතින සෙෂන් දත්ත භාවිතා කරයි...");

    const sessionId = process.env.SESSION_ID;
    if (!sessionId) {
        console.error("❌ ERROR: Railway Variables වල SESSION_ID එක ඇතුළත් කර නැත!");
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
        console.log("✅ SESSION_ID එක සාර්ථකව Restore කරන ලදී!");
    } catch (err) {
        console.error("❌ ERROR: SESSION_ID දෝෂ සහිතයි!");
        process.exit(1); 
    }
}
setupSession();

// 📊 Progress Bar Generator
function getProgressBar(percent) {
    const total = 10;
    const filled = Math.round((percent / 100) * total);
    const empty = total - filled;
    return '▰'.repeat(filled) + '▱'.repeat(empty);
}

// 📥 Live Progress Download සහ Upload Function එක
async function handleDownloadAndUpload(url, sock, msg, sendToJid) {
    const chatJid = msg.key.remoteJid;
    const progressMsg = await sock.sendMessage(chatJid, { text: `🔄 ලින්ක් එකට සම්බන්ධ වෙමින් පවතී...` }, { quoted: msg });
    
    try {
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream'
        });

        // 📝 ඔරිජිනල් ෆයිල් නම සොයාගැනීම
        let fileName = 'RV_Games_File';
        const contentDisposition = response.headers['content-disposition'];
        if (contentDisposition && contentDisposition.includes('filename=')) {
            fileName = contentDisposition.split('filename=')[1].replace(/["']/g, '');
        } else {
            const urlName = path.basename(new URL(url).pathname);
            if (urlName && urlName.includes('.')) fileName = urlName;
        }

        const totalLength = parseInt(response.headers['content-length'], 10);
        const contentType = response.headers['content-type'] || 'application/octet-stream';
        let downloadedLength = 0;
        let lastUpdateTime = Date.now();

        const tempFilePath = path.join('./', `${Date.now()}_${fileName}`);
        const writer = fs.createWriteStream(tempFilePath);

        response.data.on('data', async (chunk) => {
            downloadedLength += chunk.length;
            if (totalLength) {
                const percent = ((downloadedLength / totalLength) * 100).toFixed(1);
                const now = Date.now();
                
                // තත්පර 2කට වරක් මැසේජ් එක Edit කරයි
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

        await sock.sendMessage(chatJid, { text: `✅ *${fileName}* බාගත කළා!\n📤 දැන් WhatsApp වෙත යවමින් පවතී... ⏳`, edit: progressMsg.key }).catch(() => {});

        // ෆයිල් එක යැවීම
        await sock.sendMessage(sendToJid, { document: { url: tempFilePath }, mimetype: contentType, fileName: fileName });
        
        // Temporary ෆයිල් එක මැකීම
        fs.unlinkSync(tempFilePath);

        await sock.sendMessage(chatJid, { text: `✅ *${fileName}* සාර්ථකව යවන ලදී! 🎉`, edit: progressMsg.key }).catch(() => {});

    } catch (error) {
        console.error(error);
        await sock.sendMessage(chatJid, { text: `❌ දෝෂයක්: ලින්ක් එකෙන් ෆයිල් එක ගන්න බැරි වුණා. (${url})`, edit: progressMsg.key }).catch(() => {});
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
        browser: ['Ubuntu', 'Chrome', '22.04.4'],
        syncFullHistory: false 
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        if (!text.startsWith('.')) return; 

        const senderJid = msg.key.participant || msg.key.remoteJid; 
        const isGroup = msg.key.remoteJid.endsWith('@g.us');
        
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const urls = text.match(urlRegex) || [];

        // 1️⃣ .si Command
        if (text.startsWith('.si ')) {
            if (urls.length === 0) return await sock.sendMessage(msg.key.remoteJid, { text: 'කරුණාකර valid link එකක් ලබා දෙන්න. Ex: .si [link]' }, { quoted: msg });
            for (let url of urls) {
                await handleDownloadAndUpload(url, sock, msg, senderJid);
            }
        }

        // 2️⃣ .sg Command
        else if (text.startsWith('.sg ')) {
            if (urls.length === 0) return await sock.sendMessage(msg.key.remoteJid, { text: 'කරුණාකර valid link එකක් ලබා දෙන්න. Ex: .sg Group Name [link]' }, { quoted: msg });

            let groupName = text.replace('.sg ', '');
            urls.forEach(u => groupName = groupName.replace(u, ''));
            groupName = groupName.trim().toLowerCase();

            if (!groupName) return await sock.sendMessage(msg.key.remoteJid, { text: 'කරුණාකර Group එකේ නම ඇතුළත් කරන්න.' }, { quoted: msg });
            await sock.sendMessage(msg.key.remoteJid, { text: `🔍 '${groupName}' ගෲප් එක හොයමින් පවතී...` });

            try {
                const groups = await sock.groupFetchAllParticipating();
                let targetGroupJid = null;

                for (let jid in groups) {
                    if (groups[jid].subject.toLowerCase() === groupName) {
                        targetGroupJid = jid; break;
                    }
                }

                if (!targetGroupJid) return await sock.sendMessage(msg.key.remoteJid, { text: '❌ ඒ නමින් Group එකක් හොයාගන්න බැරි වුණා.' });
                
                for (let url of urls) {
                    await handleDownloadAndUpload(url, sock, msg, targetGroupJid);
                }
            } catch (error) {
                await sock.sendMessage(msg.key.remoteJid, { text: '❌ Group එකට යවනකොට දෝෂයක් ආවා.' });
            }
        }

        // 3️⃣ .speed Command
        else if (text.trim() === '.speed') {
            await sock.sendMessage(msg.key.remoteJid, { text: '⚡ RV Games සර්වර් වේගය පරීක්ෂා කරමින් පවතී. කරුණාකර රැඳී සිටින්න...' }, { quoted: msg });
            
            try {
                const pingStart = Date.now();
                await fetch('https://httpbin.org/ping');
                const pingTime = Date.now() - pingStart;

                const dlStart = Date.now();
                const dlResponse = await fetch('https://httpbin.org/bytes/1048576');
                if (!dlResponse.ok) throw new Error('Download failed');
                const fileBuffer = await dlResponse.arrayBuffer();
                const dlEnd = Date.now();
                
                const dlDuration = (dlEnd - dlStart) / 1000;
                const downloadSpeed = (8 / dlDuration).toFixed(2);

                const ulStart = Date.now();
                const ulResponse = await fetch('https://httpbin.org/post', {
                    method: 'POST',
                    body: fileBuffer
                });
                if (!ulResponse.ok) throw new Error('Upload failed');
                const ulEnd = Date.now();
                
                const ulDuration = (ulEnd - ulStart) / 1000;
                const uploadSpeed = (8 / ulDuration).toFixed(2);

                const speedText = `*⚡ RV Games Speed Test*\n\n` +
                                  `🏓 *Ping:* ${pingTime} ms\n` +
                                  `📥 *Download Speed:* ${downloadSpeed} Mbps\n` +
                                  `📤 *Upload Speed:* ${uploadSpeed} Mbps`;

                await sock.sendMessage(msg.key.remoteJid, { text: speedText }, { quoted: msg });

            } catch (error) {
                await sock.sendMessage(msg.key.remoteJid, { text: '❌ Speed test එක කරද්දී පොඩි අවුලක් ආවා. නැවත උත්සාහ කරන්න.' }, { quoted: msg });
            }
        }

        // 4️⃣ .menu Command
        else if (text.trim() === '.menu') {
            const menuText = `*🤖 RV Games Downloader Bot Menu*\n\n*1. .si [links]*\n> Inbox එකට ඩවුන්ලෝඩ් කරයි.\n\n*2. .sg [group name] [links]*\n> Group එකට යවයි.\n\n*3. .speed*\n> සර්වර් එකේ ඇත්තම වේගය මනියි.\n\n*4. .menu*\n> කමාන්ඩ් මෙනු එක පෙන්වයි.`;
            await sock.sendMessage(msg.key.remoteJid, { text: menuText }, { quoted: msg });
        }
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`⚠️ Connection closed. Status code: ${statusCode}`);
            
            if (statusCode === DisconnectReason.loggedOut || statusCode === 405) {
                console.log('❌ Session එක Expire වෙලා! පැරණි දත්ත මකා දමයි.');
                if (fs.existsSync(authFolder)) fs.rmSync(authFolder, { recursive: true, force: true });
                process.exit(1); 
            } else {
                console.log('🔄 Reconnecting in 5 seconds...');
                setTimeout(() => startBot(), 5000); 
            }
        } else if (connection === 'open') {
            console.log('🎉 RV Games WhatsApp Bot successfully connected!');
        }
    });
}

startBot();
