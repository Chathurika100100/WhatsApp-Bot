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

// 🔗 HELPER: RESOLVE REAL DIRECT DOWNLOAD LINK FROM HOSTPAGE
async function resolveDirectLink(url) {
    const cleanUrl = url.split('#')[0];
    if (cleanUrl.includes('fuckingfast.co')) {
        try {
            const res = await axios.get(cleanUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });
            const $ = cheerio.load(res.data);
            let directLink = $('a.btn-download').attr('href') || $('#download-btn').attr('href') || 'a[href*="/dl/"]').attr('href');
            
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

// 🕵️ FAST SCRAPER: FITGIRL -> PASTE SITE LINKS (NO TIMEOUTS)
async function getFuckingFastLinks(gameName) {
    try {
        const searchUrl = `https://fitgirl-repacks.site/?s=${encodeURIComponent(gameName)}`;
        const searchResponse = await axios.get(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });

        const $ = cheerio.load(searchResponse.data);
        const firstGameUrl = $('.entry-title a').first().attr('href');
        const firstGameTitle = $('.entry-title a').first().text().trim();

        if (!firstGameUrl) return `❌ '${gameName}' නමින් ගේම් එකක් සොයාගත නොහැකි විය.`;

        const gamePageResponse = await axios.get(firstGameUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const $game = cheerio.load(gamePageResponse.data);
        let pasteUrl = '';

        $game('a').each((i, el) => {
            const href = $game(el).attr('href');
            const text = $game(el).text();
            if (href && href.includes('paste.fitgirl-repacks.site')) {
                if (text.includes('FuckingFast') || $game(el).parent().text().includes('FuckingFast')) {
                    pasteUrl = href;
                }
            }
        });

        if (!pasteUrl) {
            $game('a').each((i, el) => {
                const href = $game(el).attr('href');
                if (href && href.includes('paste.fitgirl-repacks.site') && !pasteUrl) {
                    pasteUrl = href;
                }
            });
        }

        if (!pasteUrl) return `❌ '${firstGameTitle}' සඳහා FuckingFast ලින්ක් එකක් පිටුවේ හමුනොවිය.`;

        const pasteResponse = await axios.get(pasteUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const $paste = cheerio.load(pasteResponse.data);
        const ffmiralLinks = [];

        $paste('a').each((i, el) => {
            const href = $paste(el).attr('href');
            if (href && href.includes('fuckingfast.co')) {
                ffmiralLinks.push(href);
            }
        });

        if (ffmiralLinks.length === 0) return `❌ Paste පද්ධතිය තුළ FuckingFast ලින්ක්ස් කිසිවක් හමුනොවිය.`;

        let report = `🎮 *Game:* ${firstGameTitle}\n`;
        report += `📦 *Total Parts Found:* ${ffmiralLinks.length}\n\n`;
        report += `🔗 *FUCKINGFAST DOWNLOAD LINKS:*\n───────────────────\n`;

        for (let i = 0; i < ffmiralLinks.length; i++) {
            const partNum = String(i + 1).padStart(3, '0');
            report += `🔹 *Part ${partNum}:* ${ffmiralLinks[i]}\n`;
        }

        return report;
    } catch (error) {
        console.error(error);
        return '❌ සයිට් එක Scrape කිරීමේදී බාධාවක් ඇති විය. (Cloudflare Protection නිසා විය හැක)';
    }
}

// MAIN BOT FUNCTION WITH ADVANCED CONNECTION LOGGING
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

    // ROBUST COMMAND PARSER & EXECUTION
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

            // .command args වෙන් කර ගැනීම
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
                                 `👉 👥 \`.sgfg [GroupName] [GameName]\` - Parts ලින්ක්ස් Group එකට යැවීමට.\n` +
                                 `👉 🔐 \`.sifg [GameName]\` - Parts ලින්ක්ස් Inbox ලබා ගැනීමට.\n\n` +
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
                        const progressMsg = await sock.sendMessage(from, { text: `📥 Downloading to Inbox...` });

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

            // 👥 FITGIRL GROUP COMMAND
            if (command === 'sgfg') {
                const groupNameInput = args[0]?.replace(/[\[\]]/g, '').trim();
                const gameNameInput = args.slice(1).join(' ').trim();

                if (!groupNameInput || !gameNameInput) {
                    await sock.sendMessage(from, { text: '❌ භාවිතය: .sgfg [GroupName] [GameName]' }, { quoted: msg });
                    return;
                }

                const getGroups = await sock.groupFetchAllParticipating();
                const targetGroup = Object.values(getGroups).find(g => g.subject.toLowerCase().trim() === groupNameInput.toLowerCase());

                if (!targetGroup) {
                    await sock.sendMessage(from, { text: `❌ '${groupNameInput}' සමූහය සොයාගත නොහැක!` }, { quoted: msg });
                    return;
                }

                await sock.sendMessage(from, { text: `🔍 '${gameNameInput}' සොයමින් පවතී...` }, { quoted: msg });
                const scrapeResult = await getFuckingFastLinks(gameNameInput);
                
                await sock.sendMessage(targetGroup.id, { text: `┏━━━━━━━━━━━━━━━━━━━━━━━┓\n   🎮 *𝙵𝙸𝚃𝙶𝙸𝚁𝙻 𝚇 𝙵𝚄𝙲𝙺𝙸𝙽𝙶𝙵𝙰𝚂𝚃* 🎮\n┗━━━━━━━━━━━━━━━━━━━━━━━┛\n\n${scrapeResult}\n\n_*𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games*_` });
                await sock.sendMessage(from, { text: `✅ ලින්ක්ස් සාර්ථකව ගෘප් එකට යවන ලදී!` }, { quoted: msg });
            }

            // 🔐 FITGIRL INBOX COMMAND
            if (command === 'sifg') {
                if (from.endsWith('@g.us')) {
                    await sock.sendMessage(from, { text: '❌ මෙම විධානය Inbox හි පමණක් ක්‍රියා කරයි!' }, { quoted: msg });
                    return;
                }

                const gameNameInput = args.join(' ').trim();
                if (!gameNameInput) {
                    await sock.sendMessage(from, { text: '❌ භාවිතය: .sifg [GameName]' }, { quoted: msg });
                    return;
                }

                await sock.sendMessage(from, { text: `🔍 '${gameNameInput}' සොයමින් පවතී...` }, { quoted: msg });
                const scrapeResult = await getFuckingFastLinks(gameNameInput);

                await sock.sendMessage(from, { text: `┏━━━━━━━━━━━━━━━━━━━━━━━┓\n   🎮 *𝙵𝙸𝚃𝙶𝙸𝚁𝙻 𝚇 𝙵𝚄𝙲𝙺𝙸𝙽𝙶𝙵𝙰𝚂𝚃* 🎮\n┗━━━━━━━━━━━━━━━━━━━━━━━┛\n\n${scrapeResult}\n\n_*𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games*_` }, { quoted: msg });
            }

        } catch (globalErr) {
            console.error("Error in msg loop:", globalErr);
        }
    });
}

startBot();
