const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

// 🔐 AUTOMATIC SESSION HANDLER FROM RAILWAY VARIABLES
if (process.env.SESSION_ID) {
    if (!fs.existsSync('./session')) {
        fs.mkdirSync('./session');
    }
    try {
        const decryptedCreds = Buffer.from(process.env.SESSION_ID, 'base64').toString('utf-8');
        JSON.parse(decryptedCreds); 
        fs.writeFileSync('./session/creds.json', decryptedCreds);
        console.log("✅ SESSION_ID සාර්ථකව පද්ධතියට ඇතුළත් කරන ලදී!");
    } catch (e) {
        fs.writeFileSync('./session/creds.json', process.env.SESSION_ID);
        console.log("✅ SESSION_ID (Raw JSON) සාර්ථකව ඇතුළත් කරන ලදී!");
    }
} else {
    console.log("⚠️ අවධානයට: Railway Variables තුළ SESSION_ID එකක් හමුනොවිය!");
}

// Temporary Folder Storage
const tempFolder = './temp_downloads';
if (!fs.existsSync(tempFolder)) {
    fs.mkdirSync(tempFolder);
}

// 🔗 HELPER: BYPASS FUCKINGFAST DOWNLOAD BUTTON (FIXED 404 RELATIVE URLS)
async function resolveDirectLink(url) {
    const cleanUrl = url.split('#')[0];
    if (cleanUrl.includes('fuckingfast.co')) {
        try {
            const res = await axios.get(cleanUrl, {
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
                },
                timeout: 30000
            });
            
            const $ = cheerio.load(res.data);
            const form = $('form');
            
            if (form.length > 0) {
                let formAction = form.attr('action') || '';
                // FIX: Convert relative paths (e.g. /dl/...) to absolute URLs to prevent 404 errors
                if (formAction && !formAction.startsWith('http')) {
                    formAction = new URL(formAction, cleanUrl).href;
                } else if (!formAction) {
                    formAction = cleanUrl;
                }

                let formData = new URLSearchParams();
                form.find('input').each((i, input) => {
                    const name = $(input).attr('name');
                    const value = $(input).attr('value');
                    if (name) {
                        formData.append(name, value || '');
                    }
                });

                const postRes = await axios.post(formAction, formData.toString(), {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Referer': cleanUrl,
                        'Origin': 'https://fuckingfast.co'
                    },
                    maxRedirects: 0,
                    timeout: 30000,
                    validateStatus: function (status) {
                        return status >= 200 && status < 400; 
                    }
                });

                const directLink = postRes.headers['location'] || postRes.config.url;
                if (directLink && directLink !== cleanUrl) {
                    return directLink;
                }
            }

            let directLink = $('a.btn-download').attr('href') || $('#download-btn').attr('href');
            return directLink || url;
        } catch (e) {
            if (e.response && e.response.headers && e.response.headers['location']) {
                return e.response.headers['location'];
            }
            console.error("🚫 FuckingFast Bypass Error:", e.message);
            return url;
        }
    }
    return url;
}

// ⏳ LIVE PROGRESS DOWNLOADER HELPER (Stream Optimization to Prevent OOM Crashes)
async function downloadFileWithProgress(url, outputPath, sock, from, quotedMsg) {
    const finalUrl = await resolveDirectLink(url);
    
    const response = await axios({ 
        method: 'get', 
        url: finalUrl, 
        responseType: 'stream', 
        timeout: 60000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
    });
    
    let realFileName = `file_${Date.now()}.bin`;
    const cd = response.headers['content-disposition'];
    if (cd) {
        const fm = cd.match(/filename\*?=["']?(?:UTF-8'')?([^"'\n;]+)["']?/i) || cd.match(/filename=["']?([^"'\n;]+)["']?/i);
        if (fm && fm[1]) realFileName = decodeURIComponent(fm[1]).replace(/["']/g, "").trim();
    }
    const mimetype = response.headers['content-type'] || 'application/octet-stream';

    const totalBytes = parseInt(response.headers['content-length'], 10) || 0;
    let downloadedBytes = 0;
    
    const progressMsg = await sock.sendMessage(from, { text: `⏳ ඩවුන්ලෝඩ් එක සූදානම් කරමින් පවතී...` }, { quoted: quotedMsg });
    
    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);
    
    let lastUpdate = Date.now();
    response.data.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const now = Date.now();
        // Send status updates every 3 seconds to avoid spamming WhatsApp network
        if (now - lastUpdate > 3000 && totalBytes > 0) {
            lastUpdate = now;
            const percentage = ((downloadedBytes / totalBytes) * 100).toFixed(1);
            const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
            const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
            const filled = Math.min(10, Math.round((downloadedBytes / totalBytes) * 10));
            const bar = '■'.repeat(filled) + '□'.repeat(10 - filled);
            
            sock.sendMessage(from, { 
                text: `⏳ *DOWNLOADING FILE*\n\n📁 *File:* \`${realFileName}\`\n📊 *Progress:* [${bar}] ${percentage}%\n📦 *Size:* ${downloadedMB} MB / ${totalMB} MB\n\n_𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games_`,
                edit: progressMsg.key 
            }).catch(() => {});
        }
    });

    await new Promise((resolve, reject) => {
        writer.on('finish', () => {
            sock.sendMessage(from, { text: `✅ ඩවුන්ලෝඩ් එක සාර්ථකයි! දැන් WhatsApp වෙත අප්ලෝඩ් වෙමින් පවතී...`, edit: progressMsg.key }).catch(() => {});
            resolve();
        });
        writer.on('error', reject);
        response.data.on('error', reject);
    });

    return { realFileName, mimetype, progressKey: progressMsg.key };
}

// MAIN BOT FUNCTION
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect.error?.output?.statusCode || lastDisconnect.error?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Bot සාර්ථකව සම්බන්ධ වුණා!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const msg = messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const text = msg.message.conversation || 
                         msg.message.extendedTextMessage?.text || 
                         msg.message.imageMessage?.caption || '';
            
            const from = msg.key.remoteJid;
            const trimmedText = text.trim();

            if (!trimmedText.startsWith('.')) return;

            const args = trimmedText.slice(1).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            // 📄 MENU COMMAND
            if (command === 'menu') {
                const menuText = `🤖 *𝚁𝚅 𝙶𝙰𝙼𝙴𝚂 𝚆𝙷𝙰𝚃𝚂𝙰𝙿𝙿 𝙱𝙾𝚃* 🤖\n\n` +
                                 `⚙️ *ප්‍රධාන විධානයන්:*\n` +
                                 `👉 📄 \`.menu\` - මෙනුව ලබා ගැනීමට.\n` +
                                 `👉 ⚡ \`.speed\` - සර්වර් වේගය බැලීමට.\n` +
                                 `👉 📥 \`.sg [GroupName] [Link]\` - ෆයිල් එක Group එකට යැවීමට.\n` +
                                 `👉 📥 \`.si [Link]\` - ෆයිල් එක Inbox ලබා ගැනීමට.\n\n` +
                                 `_*𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games*_`;
                                 
                await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                return;
            }

            // ⚡ SPEED TEST COMMAND
            if (command === 'speed') {
                await sock.sendMessage(from, { text: '⚡ වේගය පරීක්ෂා කරමින් පවතී...' }, { quoted: msg });
                try {
                    const pingStart = performance.now();
                    await axios.get('https://www.google.com', { timeout: 10000 });
                    const ping = (performance.now() - pingStart).toFixed(0);

                    // Download test
                    const dlStart = performance.now();
                    await axios.get('https://speed.cloudflare.com/__down?bytes=1048576', { responseType: 'arraybuffer', timeout: 15000 });
                    const dlTime = (performance.now() - dlStart) / 1000; 
                    const downloadSpeed = ((1 / dlTime) * 8).toFixed(2); 

                    // Upload test
                    const ulStart = performance.now();
                    const dummyBuffer = Buffer.alloc(1024 * 1024);
                    await axios.post('https://httpbin.org/post', dummyBuffer, {
                        headers: { 'Content-Type': 'application/octet-stream' },
                        timeout: 15000
                    });
                    const ulTime = (performance.now() - ulStart) / 1000;
                    const uploadSpeed = ((1 / ulTime) * 8).toFixed(2);

                    const speedResult = `⚡ *𝚂𝙴𝚁𝚅𝙴𝚁 𝚂𝙿𝙴𝙴𝙳 𝚃𝙴𝚂𝚃 𝚁𝙴𝚂𝚄𝙻𝚃𝚂*\n\n` +
                                        `🔹 *Ping:* ${ping} ms\n` +
                                        `🔹 *Download Speed:* ${downloadSpeed} Mbps\n` +
                                        `🔹 *Upload Speed:* ${uploadSpeed} Mbps\n\n` +
                                        `_𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games_`;

                    await sock.sendMessage(from, { text: speedResult }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: `❌ වේගය මැනීමේ දෝෂයකි: ${err.message}` }, { quoted: msg });
                }
                return;
            }

            // 📥 DOWNLOAD AND SEND TO GROUP (.sg GroupName Link)
            if (command === 'sg') {
                const fullBody = args.join(' ');
                const urlRegex = /(https?:\/\/[^\s]+)/g;
                const links = fullBody.match(urlRegex) || [];
                let groupNameInput = fullBody.replace(urlRegex, '').trim().replace(/[\[\]]/g, '').trim();

                if (!groupNameInput || links.length === 0) {
                    await sock.sendMessage(from, { text: '❌ භාවිතය: .sg [Group Name] [Link]' }, { quoted: msg });
                    return;
                }

                const getGroups = await sock.groupFetchAllParticipating();
                const targetGroup = Object.values(getGroups).find(g => g.subject.toLowerCase().trim() === groupNameInput.toLowerCase());

                if (!targetGroup) {
                    await sock.sendMessage(from, { text: `❌ '${groupNameInput}' සමූහය සොයාගත නොහැක!` }, { quoted: msg });
                    return;
                }

                for (let i = 0; i < links.length; i++) {
                    let tempFilePath = path.join(tempFolder, `temp_sg_${Date.now()}_${i}`);
                    let activeProgressKey = null;
                    try {
                        const fileInfo = await downloadFileWithProgress(links[i], tempFilePath, sock, from, msg);
                        activeProgressKey = fileInfo.progressKey;
                        
                        // FIX OOM: Pass a ReadStream instead of path URL string to ensure Baileys streams the file out of RAM
                        await sock.sendMessage(targetGroup.id, { 
                            document: fs.createReadStream(tempFilePath), 
                            fileName: fileInfo.realFileName, 
                            mimetype: fileInfo.mimetype 
                        });
                        
                        if (activeProgressKey) {
                            await sock.sendMessage(from, { text: `✅ \`${fileInfo.realFileName}\` සාර්ථකව ${groupNameInput} සමූහයට යවන ලදී!`, edit: activeProgressKey });
                        }
                    } catch (e) {
                        console.error(e);
                        await sock.sendMessage(from, { text: `❌ බාගත කිරීමේ හෝ යැවීමේ දෝෂයකි: ${e.message}` }, { quoted: msg });
                    } finally {
                        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                    }
                }
            }

            // 🔐 DOWNLOAD AND SEND TO INBOX (.si Link)
            if (command === 'si') {
                if (from.endsWith('@g.us')) {
                    await sock.sendMessage(from, { text: '❌ මෙම විධානය Inbox හි පමණක් ක්‍රියා කරයි!' }, { quoted: msg });
                    return;
                }

                const links = args.join(' ').match(/(https?:\/\/[^\s]+)/g) || [];
                if (links.length === 0) {
                    await sock.sendMessage(from, { text: '❌ භාවිතය: .si [Link]' }, { quoted: msg });
                    return;
                }

                for (let i = 0; i < links.length; i++) {
                    let tempFilePath = path.join(tempFolder, `temp_si_${Date.now()}_${i}`);
                    let activeProgressKey = null;
                    try {
                        const fileInfo = await downloadFileWithProgress(links[i], tempFilePath, sock, from, msg);
                        activeProgressKey = fileInfo.progressKey;

                        // FIX OOM: Stream file from disk to network directly
                        await sock.sendMessage(from, { 
                            document: fs.createReadStream(tempFilePath), 
                            fileName: fileInfo.realFileName, 
                            mimetype: fileInfo.mimetype 
                        });
                        
                        if (activeProgressKey) {
                            await sock.sendMessage(from, { text: `✅ \`${fileInfo.realFileName}\` සාර්ථකව Inbox වෙත එවන ලදී!`, edit: activeProgressKey });
                        }
                    } catch (e) {
                        console.error(e);
                        await sock.sendMessage(from, { text: `❌ බාගත කිරීමේ දෝෂයකි: ${e.message}` }, { quoted: msg });
                    } finally {
                        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                    }
                }
            }

        } catch (globalErr) {
            console.error("Error in msg loop:", globalErr);
        }
    });
}

startBot();
