const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { Transform } = require('stream');

// 🔐 SESSION INITIALIZER
const sessionPath = './session';
if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath);

if (process.env.SESSION_ID) {
    try {
        let decryptedCreds = '';
        if (process.env.SESSION_ID.startsWith('node_')) {
            decryptedCreds = Buffer.from(process.env.SESSION_ID.replace('node_', ''), 'base64').toString('utf-8');
        } else {
            decryptedCreds = Buffer.from(process.env.SESSION_ID, 'base64').toString('utf-8');
        }
        JSON.parse(decryptedCreds); 
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), decryptedCreds);
        console.log("✅ SESSION_ID සාර්ථකව පද්ධතියට ඇතුළත් කරන ලදී!");
    } catch (e) {
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), process.env.SESSION_ID);
        console.log("✅ SESSION_ID (Raw JSON) සාර්ථකව ඇතුළත් කරන ලදී!");
    }
}

// 📂 FIX: RAILWAY WRITE PERMISSION FIX (USING OS TMP FOLDER)
const tempFolder = '/tmp/temp_downloads'; 
if (!fs.existsSync(tempFolder)) {
    fs.mkdirSync(tempFolder, { recursive: true });
}

// 🔗 BYPASS DIRECT LINK EXTRACTOR
async function resolveDirectLink(url) {
    const cleanUrl = url.split('#')[0];
    if (cleanUrl.includes('fuckingfast.co')) {
        try {
            const res = await axios.get(cleanUrl, {
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    'Accept': 'text/html'
                },
                timeout: 30000
            });
            
            const $ = cheerio.load(res.data);
            const form = $('form');
            
            if (form.length > 0) {
                let formAction = form.attr('action') || cleanUrl;
                if (!formAction.startsWith('http')) formAction = new URL(formAction, cleanUrl).href;

                let formData = new URLSearchParams();
                form.find('input').each((i, input) => {
                    const name = $(input).attr('name');
                    if (name) formData.append(name, $(input).attr('value') || '');
                });

                const postRes = await axios.post(formAction, formData.toString(), {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    maxRedirects: 0,
                    validateStatus: status => status >= 200 && status < 400
                });

                const directLink = postRes.headers['location'] || postRes.config.url;
                if (directLink && directLink !== cleanUrl) return directLink;
            }
            return $('a.btn-download').attr('href') || $('#download-btn').attr('href') || url;
        } catch (e) {
            if (e.response?.headers?.location) return e.response.headers.location;
            return url;
        }
    }
    return url;
}

// ⏳ LIVE PROGRESS DOWNLOADER (DISK BUFFERED STREAM)
async function downloadFileWithProgress(url, outputPath, sock, from, quotedMsg) {
    const finalUrl = await resolveDirectLink(url);
    const response = await axios({ method: 'get', url: finalUrl, responseType: 'stream', timeout: 120000 });
    
    let realFileName = `file_${Date.now()}.bin`;
    const cd = response.headers['content-disposition'];
    if (cd) {
        const fm = cd.match(/filename\*?=["']?(?:UTF-8'')?([^"'\n;]+)["']?/i);
        if (fm && fm[1]) realFileName = decodeURIComponent(fm[1]).replace(/["']/g, "").trim();
    }
    const mimetype = response.headers['content-type'] || 'application/octet-stream';
    const totalBytes = parseInt(response.headers['content-length'], 10) || 0;
    
    const progressMsg = await sock.sendMessage(from, { text: `⏳ ඩවුන්ලෝඩ් එක සූදානම් කරමින් පවතී...` }, { quoted: quotedMsg });
    
    let downloadedBytes = 0;
    let lastUpdate = Date.now();

    const progressTracker = new Transform({
        transform(chunk, encoding, callback) {
            downloadedBytes += chunk.length;
            const now = Date.now();
            if (now - lastUpdate > 5000 && totalBytes > 0) {
                lastUpdate = now;
                const percentage = ((downloadedBytes / totalBytes) * 100).toFixed(1);
                const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
                const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
                const filled = Math.round((downloadedBytes / totalBytes) * 10);
                const bar = '■'.repeat(filled) + '□'.repeat(10 - filled);
                
                sock.sendMessage(from, { 
                    text: `⏳ *DOWNLOADING FILE*\n\n📁 *File:* \`${realFileName}\`\n📊 *Progress:* [${bar}] ${percentage}%\n📦 *Size:* ${downloadedMB} MB / ${totalMB} MB\n\n_𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈 RV Games_`,
                    edit: progressMsg.key 
                }).catch(() => {});
            }
            this.push(chunk);
            callback();
        }
    });

    const writer = fs.createWriteStream(outputPath);
    await new Promise((resolve, reject) => {
        response.data.pipe(progressTracker).pipe(writer);
        writer.on('finish', () => {
            sock.sendMessage(from, { text: `✅ ඩවුන්ලෝඩ් එක සාර්ථකයි! දැන් WhatsApp වෙත අප්ලෝඩ් වෙමින් පවතී...`, edit: progressMsg.key }).catch(() => {});
            resolve();
        });
        writer.on('error', reject);
        response.data.on('error', reject);
    });

    return { realFileName, mimetype, progressKey: progressMsg.key };
}

// 🤖 MAIN BOT FUNCTION
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log('🔄 Reconnecting Bot...');
                await delay(5000);
                startBot();
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Bot සාර්ථකව සම්බන්ධ වුණා!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message) return;

        const messageContent = msg.message.ephemeralMessage?.message || msg.message.viewOnceMessage?.message || msg.message;
        let text = messageContent.conversation || 
                   messageContent.extendedTextMessage?.text || 
                   messageContent.imageMessage?.caption || 
                   messageContent.videoMessage?.caption || '';

        text = text.trim();
        if (!text.startsWith('.')) return;

        const from = msg.key.remoteJid;
        const args = text.slice(1).split(/ +/);
        const command = args.shift().toLowerCase();

        console.log(`💬 Command Received: .${command}`);

        // 📄 MENU COMMAND
        if (command === 'menu') {
            const menuText = `🤖 *𝚁𝚅 𝙶𝙰𝙼𝙴𝚂 𝚆𝙷𝙰𝚃𝚂𝙰𝙿𝙿 𝙱𝙾𝚃* 🤖\n\n⚙️ *ප්‍රධාන විධානයන්:*\n👉 📄 \`.menu\`\n👉 ⚡ \`.speed\`\n👉 📥 \`.sg [Group Name] [Link]\`\n👉 📥 \`.si [Link]\``;
            await sock.sendMessage(from, { text: menuText }, { quoted: msg });
        }

        // ⚡ SPEED TEST
        if (command === 'speed') {
            await sock.sendMessage(from, { text: '⚡ වේගය පරීක්ෂා කරමින් පවතී...' }, { quoted: msg });
            try {
                const start = performance.now();
                await axios.get('https://www.google.com', { timeout: 10000 });
                const ping = (performance.now() - start).toFixed(0);
                await sock.sendMessage(from, { text: `⚡ *Server Speed:*\n🔹 Ping: ${ping} ms` }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ දෝෂයකි: ${err.message}` }, { quoted: msg });
            }
        }

        // 📥 GROUP & INBOX DOWNLOAD
        if (command === 'sg' || command === 'si') {
            const fullBody = args.join(' ');
            const links = fullBody.match(/(https?:\/\/[^\s]+)/g) || [];
            
            if (links.length === 0) return await sock.sendMessage(from, { text: `❌ භාවිතය: .${command} [Link]` }, { quoted: msg });

            let targetJid = from;
            if (command === 'sg') {
                const groupName = fullBody.replace(/(https?:\/\/[^\s]+)/g, '').replace(/[\[\]]/g, '').trim();
                if (!groupName) return await sock.sendMessage(from, { text: '❌ සමූහයේ නම ඇතුළත් කරන්න.' }, { quoted: msg });
                
                const groups = await sock.groupFetchAllParticipating();
                const targetGroup = Object.values(groups).find(g => g.subject.toLowerCase() === groupName.toLowerCase());
                if (!targetGroup) return await sock.sendMessage(from, { text: `❌ '${groupName}' සමූහය සොයාගත නොහැක!` }, { quoted: msg });
                targetJid = targetGroup.id;
            }

            for (let i = 0; i < links.length; i++) {
                const tempFilePath = path.join(tempFolder, `dl_${Date.now()}_${i}.bin`);
                let progressKey = null;

                try {
                    const fileInfo = await downloadFileWithProgress(links[i], tempFilePath, sock, from, msg);
                    progressKey = fileInfo.progressKey;
                    
                    // Safe stream upload straight from write-allowed /tmp
                    await sock.sendMessage(targetJid, { 
                        document: fs.createReadStream(tempFilePath), 
                        fileName: fileInfo.realFileName, 
                        mimetype: fileInfo.mimetype 
                    });
                    
                    if (progressKey) {
                        await sock.sendMessage(from, { text: `✅ \`${fileInfo.realFileName}\` සාර්ථකව යවන ලදී!`, edit: progressKey });
                    }
                } catch (e) {
                    await sock.sendMessage(from, { text: `❌ දෝෂයකි: ${e.message}` }, { quoted: msg });
                } finally {
                    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                }
            }
        }
    });
}

startBot();
