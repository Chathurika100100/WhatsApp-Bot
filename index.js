const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

// 🔐 METHOD 1: AUTOMATIC SESSION HANDLER FROM RAILWAY VARIABLES
if (process.env.SESSION_ID) {
    if (!fs.existsSync('./session')) {
        fs.mkdirSync('./session');
    }
    try {
        const decryptedCreds = Buffer.from(process.env.SESSION_ID, 'base64').toString('utf-8');
        JSON.parse(decryptedCreds); 
        fs.writeFileSync('./session/creds.json', decryptedCreds);
        console.log("✅ SESSION_ID සාර්ථකව පද්ධතියට ඇතුළත් කරන ลදී!");
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

// Global Memory Session to hold FitGirl search results for 2-step command
let userSessions = {};

// 🔗 HELPER: RESOLVE REAL DIRECT DOWNLOAD LINK FROM HOSTPAGE
async function resolveDirectLink(url) {
    const cleanUrl = url.split('#')[0];
    if (cleanUrl.includes('fuckingfast.co')) {
        try {
            const res = await axios.get(cleanUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });
            const $ = cheerio.load(res.data);
            let directLink = $('a.btn-download').attr('href') || $('#download-btn').attr('href') || $('a[href*="/dl/"]').attr('href');
            
            if (!directLink) {
                $('a').each((i, el) => {
                    const href = $(el).attr('href');
                    if (href && (href.includes('/download/') || href.includes('/dl/') || href.includes('storage.'))) {
                        directLink = href;
                    }
                });
            }
            return directLink || url;
        } catch (e) {
            return url;
        }
    }
    return url;
}

// 🔍 FITGIRL FUNCTIONS
async function searchFitGirl(query) {
    try {
        const url = `https://fitgirl-repacks.site/?s=${encodeURIComponent(query)}`;
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const $ = cheerio.load(response.data);
        let results = [];

        $('article.post').each((i, el) => {
            const title = $(el).find('h1.entry-title a').text().trim();
            const link = $(el).find('h1.entry-title a').attr('href');
            if (title && link) {
                results.push({ title, link });
            }
        });
        return results;
    } catch (error) {
        console.error("Search Error:", error);
        return [];
    }
}

async function getFitGirlLinks(pageUrl) {
    try {
        const response = await axios.get(pageUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const $ = cheerio.load(response.data);
        let mirrors = [];

        $('div.entry-content ul li').each((i, el) => {
            const text = $(el).text().trim();
            const link = $(el).find('a').attr('href');
            
            if (link && (link.includes('paste.fitgirl') || link.includes('fuckingfast') || link.includes('datanodes') || link.includes('1337x') || link.includes('magnet'))) {
                let cleanText = text.replace('Click to show direct links', '').trim();
                mirrors.push(`🔗 *${cleanText}*:\n${link}`);
            }
        });
        return mirrors;
    } catch (error) {
        console.error("Link Fetch Error:", error);
        return [];
    }
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
        const { connection, lastDisconnect, qr } = update;
        if (qr) console.log('⚠️ අවධානයට: අලුත් QR කේතයක් ජනනය විය. ඔයාගේ SESSION_ID එක වැරදි හෝ කල් ඉකුත් වී ඇත!');
        if (connection === 'connecting') console.log('⏳ WhatsApp වෙත සම්බන්ධ වෙමින් පවතී...');
        
        if (connection === 'close') {
            const statusCode = lastDisconnect.error?.output?.statusCode || lastDisconnect.error?.statusCode;
            console.log(`❌ සම්බන්ධතාවය බිඳ වැටුණා. Code: ${statusCode}`);
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log('🔄 තත්පර 5 කින් නැවත සම්බන්ධ වීමට උත්සාහ කරයි...');
                setTimeout(() => startBot(), 5000);
            } else {
                console.log('🛑 ගිණුමෙන් ඉවත් වී ඇත (Logged Out). කරුණාකර අලුත් SESSION_ID එකක් දමන්න.');
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Bot සාර්ථකව සම්බන්ධ වුණා සහ සක්‍රීයයි!');
        }
    });

    // COMMAND PARSER
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
                                 `🎮 *𝙵𝙸𝚃𝙶𝙸𝚁𝙻 𝙲𝙾𝙼𝙼𝙰𝙽𝙳𝚂:*\n` +
                                 `👉 🔍 \`.fitgirl [GameName]\` - ගේම් එකක් සර්ච් කිරීමට.\n` +
                                 `👉 📦 \`.fgparts [Number]\` - අංකය ඇතුළත් කර ලින්ක්ස් ගැනීමට.\n\n` +
                                 `_*𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games*_`;
                                 
                await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                return;
            }

            // ⚡ SPEED TEST COMMAND
            if (command === 'speed') {
                await sock.sendMessage(from, { text: '⚡ වේගය පරීක්ෂා කරමින් පවතී...' }, { quoted: msg });
                try {
                    const pingStart = performance.now();
                    await axios.get('https://www.google.com');
                    const ping = (performance.now() - pingStart).toFixed(0);

                    const dlStart = performance.now();
                    await axios.get('https://speed.cloudflare.com/__down?bytes=1048576', { responseType: 'arraybuffer' });
                    const dlTime = (performance.now() - dlStart) / 1000; 
                    const downloadSpeed = ((1 / dlTime) * 8).toFixed(2); 

                    const speedResult = `⚡ *𝚂𝙴𝚁𝚅𝙴𝚁 𝚂𝙿𝙴𝙴𝙳 𝚃𝙴𝚂𝚃 𝚁𝙴𝚂𝚄𝙻𝚃𝚂*\n\n` +
                                        `🔹 *Ping:* ${ping} ms\n` +
                                        `🔹 *Download Speed:* ${downloadSpeed} Mbps\n\n` +
                                        `_𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games_`;

                    await sock.sendMessage(from, { text: speedResult }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: `❌ දෝෂයකි: ${err.message}` }, { quoted: msg });
                }
                return;
            }

            // 📥 DOWNLOAD AND SEND TO GROUP
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

                await sock.sendMessage(from, { text: `⏳ ඩවුන්ලෝඩ් එක සූදානම් කරමින් පවතී...` }, { quoted: msg });

                for (let i = 0; i < links.length; i++) {
                    let tempFilePath = '';
                    try {
                        const finalUrl = await resolveDirectLink(links[i]);
                        let realFileName = `file_${Date.now()}.bin`;
                        
                        const response = await axios({ method: 'get', url: finalUrl, responseType: 'stream', maxContentLength: Infinity, maxBodyLength: Infinity, timeout: 0 });
                        
                        const contentDisposition = response.headers['content-disposition'];
                        if (contentDisposition) {
                            const fileNameMatch = contentDisposition.match(/filename\*?=["']?(?:UTF-8'')?([^"'\n;]+)["']?/i) || contentDisposition.match(/filename=["']?([^"'\n;]+)["']?/i);
                            if (fileNameMatch && fileNameMatch[1]) realFileName = decodeURIComponent(fileNameMatch[1]).replace(/["']/g, "").trim();
                        }

                        tempFilePath = path.join(tempFolder, `temp_${Date.now()}_${i}`);
                        const progressMsg = await sock.sendMessage(from, { text: `📥 *Downloading:* ${realFileName}\n📊 ▱▱▱▱▱▱▱▱▱▱ 0.0%` });

                        const totalBytes = parseInt(response.headers['content-length'], 10) || 0;
                        let downloadedBytes = 0;
                        let lastUpdateTime = Date.now();

                        response.data.on('data', async (chunk) => {
                            downloadedBytes += chunk.length;
                            const now = Date.now();
                            if (now - lastUpdateTime > 3000) {
                                lastUpdateTime = now;
                                const percentage = totalBytes ? ((downloadedBytes / totalBytes) * 100).toFixed(1) : 0;
                                const filledBlocks = Math.round((percentage / 100) * 10);
                                const progressBar = '▰'.repeat(filledBlocks) + '▱'.repeat(10 - filledBlocks);
                                try { await sock.sendMessage(from, { text: `📥 *Downloading:* ${realFileName}\n📊 ${progressBar} ${percentage}%`, edit: progressMsg.key }); } catch (e) {}
                            }
                        });

                        const writer = fs.createWriteStream(tempFilePath);
                        response.data.pipe(writer);
                        await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });

                        await sock.sendMessage(from, { text: `📤 *Uploading to Group...*`, edit: progressMsg.key });
                        await sock.sendMessage(targetGroup.id, { document: { url: tempFilePath }, fileName: realFileName, mimetype: response.headers['content-type'] || 'application/octet-stream', caption: `*𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games*` });
                        try { await sock.sendMessage(from, { text: `✅ Uploader Success!`, edit: progressMsg.key }); } catch (e) {}
                    } catch (e) {
                        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
                    } finally {
                        if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                    }
                }
            }

            // 🔐 DOWNLOAD AND SEND TO INBOX
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

                for (let link of links) {
                    let tempFilePath = '';
                    try {
                        const finalUrl = await resolveDirectLink(link);
                        let realFileName = `file_${Date.now()}.bin`;

                        const response = await axios({ method: 'get', url: finalUrl, responseType: 'stream', timeout: 0 });
                        
                        tempFilePath = path.join(tempFolder, `temp_inbox_${Date.now()}`);
                        await sock.sendMessage(from, { text: `📥 Downloading ${realFileName} to Inbox...` }, { quoted: msg });

                        const writer = fs.createWriteStream(tempFilePath);
                        response.data.pipe(writer);
                        await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });

                        await sock.sendMessage(from, { document: { url: tempFilePath }, fileName: realFileName, mimetype: 'application/octet-stream', caption: `*𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games*` });
                    } catch (e) {
                        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
                    } finally {
                        if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                    }
                }
            }

            // 🛑 STEP 1: FITGIRL SITE SEARCH (.fitgirl [Game Name])
            if (command === 'fitgirl') {
                const query = args.join(' ').trim();
                if (!query) {
                    return await sock.sendMessage(from, { text: '❌ භාවිතය: .fitgirl [Game Name]\n(උදා: .fitgirl gta v)' }, { quoted: msg });
                }

                await sock.sendMessage(from, { text: `🔍 *${query}* සඳහා FitGirl Repacks සයිට් එක පරීක්ෂා කරමින් පවතී...` }, { quoted: msg });
                
                const results = await searchFitGirl(query);
                if (results.length === 0) {
                    return await sock.sendMessage(from, { text: '❌ කිසිදු ගේම් එකක් සොයා ගැනීමට නොහැකි විය.' }, { quoted: msg });
                }

                // Save search results context for this user chat
                userSessions[from] = results; 
                
                let responseText = `🎮 *FitGirl Search Results for:* _${query}_\n\n`;
                results.forEach((res, index) => {
                    responseText += `*${index + 1}.* ${res.title}\n`;
                });
                responseText += `\n👉 දැන් ඔබට අවශ්‍ය ගේම් එකේ අංකය ලබා දී ලින්ක්ස් ලබා ගන්න: \n*.fgparts <number>* (උදා: .fgparts 1)`;
                
                await sock.sendMessage(from, { text: responseText }, { quoted: msg });
                return;
            }

            // 🛑 STEP 2: GET PARTS AND MIRRORS BASED ON SELECTION (.fgparts [Number])
            if (command === 'fgparts') {
                const index = parseInt(args[0]) - 1;
                
                if (!userSessions[from] || isNaN(index) || !userSessions[from][index]) {
                    return await sock.sendMessage(from, { text: '❌ වැරදි අංකයක් හෝ ඔබ තවමත් සර්ච් කර නැත. කරුණාකර මුලින්ම සර්ච් කරන්න: \n.fitgirl [Game Name]' }, { quoted: msg });
                }

                const selectedGame = userSessions[from][index];
                await sock.sendMessage(from, { text: `⏳ *${selectedGame.title}* සඳහා බාගත හැකි මිරර් ලින්ක්ස් එකතු කරමින් පවතී...` }, { quoted: msg });

                const links = await getFitGirlLinks(selectedGame.link);
                if (links.length === 0) {
                    return await sock.sendMessage(from, { text: '❌ මෙම පිටුවෙන් සෘජුවම ලින්ක්ස් කියවීමට නොහැකි විය.' }, { quoted: msg });
                }

                let responseText = `┏━━━━━━━━━━━━━━━━━━━━━━━┓\n   🎮 *𝙵𝙸𝚃𝙶𝙸𝚁𝙻 𝙳𝙾𝚆𝙽𝙻𝙾𝙰𝙳 𝙻𝙸𝙽𝙺𝚂* 🎮\n┗━━━━━━━━━━━━━━━━━━━━━━━┛\n\n`;
                responseText += `📦 *Game:* ${selectedGame.title}\n\n`;
                responseText += links.join('\n\n');
                responseText += `\n\n_*𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games*_`;
                
                await sock.sendMessage(from, { text: responseText }, { quoted: msg });
                return;
            }

        } catch (globalErr) {
            console.error("Error in msg loop:", globalErr);
        }
    });
}

startBot();
