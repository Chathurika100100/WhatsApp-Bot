const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

// Railway / Koyeb Environment Session Handler
if (process.env.SESSION_ID) {
    if (!fs.existsSync('./session')) {
        fs.mkdirSync('./session');
    }
    try {
        const decryptedCreds = Buffer.from(process.env.SESSION_ID, 'base64').toString('utf-8');
        JSON.parse(decryptedCreds); 
        fs.writeFileSync('./session/creds.json', decryptedCreds);
    } catch (e) {
        fs.writeFileSync('./session/creds.json', process.env.SESSION_ID);
    }
}

// Temporary Folder Storage
const tempFolder = './temp_downloads';
if (!fs.existsSync(tempFolder)) {
    fs.mkdirSync(tempFolder);
}

// 🕵️ FITGIRL TO FUCKINGFAST LINK EXTRACTOR FUNCTION
async function getFuckingFastLinks(gameName) {
    try {
        // 1. FitGirl සයිට් එක සර්ච් කිරීම
        const searchUrl = `https://fitgirl-repacks.site/?s=${encodeURIComponent(gameName)}`;
        const searchResponse = await axios.get(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        const $ = cheerio.load(searchResponse.data);
        const firstGameUrl = $('.entry-title a').first().attr('href');
        const firstGameTitle = $('.entry-title a').first().text().trim();

        if (!firstGameUrl) return `❌ '${gameName}' නමින් ගේම් එකක් සොයාගත නොහැකි විය.`;

        // 2. ගේම් පිටුවට ගොස් FuckingFast Paste ලින්ක් එක සෙවීම
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

        // 3. Paste සයිට් එකෙන් FuckingFast Parts ලින්ක්ස් ටික ඇදගැනීම
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

        // 4. මැසේජ් රිපෝට් එක සකස් කිරීම
        let report = `🎮 *Game:* ${firstGameTitle}\n`;
        report += `📦 *Total Parts Found:* ${ffmiralLinks.length}\n\n`;
        report += `🔗 *FUCKINGFAST DOWNLOAD LINKS (500MB PARTS):*\n───────────────────\n`;

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
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`සම්බන්ධතාවය බිඳ වැටුණා. නැවත උත්සාහ කරයි...`, shouldReconnect);
            if (shouldReconnect) setTimeout(() => startBot(), 5000);
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Bot සාර්ථකව සම්බන්ධ වුණා!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const from = msg.key.remoteJid;

        // 1. MENU COMMAND (.menu)
        if (text === '.menu') {
            const menuText = `🤖 *𝚁𝚅 𝙶𝙰𝙼𝙴𝚂 𝚆𝙷𝙰𝚃𝚂𝙰𝙿𝙿 𝙱𝙾𝚃* 🤖\n\n` +
                             `👋 ආයුබෝවන්! මෙන්න මගේ විධානයන් (Commands) ලැයිස්තුව:\n\n` +
                             `⚙️ *ප්‍රධාන විධානයන්:*\n` +
                             `👉 📄 \`.menu\` - මෙම මෙනුව ලබා ගැනීමට.\n` +
                             `👉 ⚡ \`.speed\` - සර්වර් එකේ වේගය බැලීමට.\n` +
                             `👉 📥 \`.sg [GroupName] [Link]\` - ෆයිල් ඩවුන්ලෝඩ් කර Group එකට යැවීමට.\n` +
                             `👉 📥 \`.si [Link]\` - ෆයිල් ඩවුන්ලෝඩ් කර Inbox එකට ලබා ගැනීමට (Inbox Only).\n\n` +
                             `🎮 *𝙵𝙸𝚃𝙶𝙸𝚁𝙻 𝚁𝙴𝙿𝙰𝙲𝙺𝚂 𝙲𝙾𝙼𝙼𝙰𝙽𝙳𝚂:*\n` +
                             `👉 👥 \`.sgfg [GroupName] [GameName]\` - ගේම් Parts ලින්ක්ස් Group එකට ලබා ගැනීමට.\n` +
                             `👉 🔐 \`.sifg [GameName]\` - ගේම් Parts ලින්ක්ස් Inbox එකට ලබා ගැනීමට (Inbox Only).\n\n` +
                             `_*𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games*_`;
                             
            await sock.sendMessage(from, { text: menuText }, { quoted: msg });
            return;
        }

        // 2. SPEED TEST COMMAND (.speed)
        if (text === '.speed') {
            await sock.sendMessage(from, { text: '⚡ වේගය පරීක්ෂා කරමින් පවතී, කරුණාකර රැඳී සිටින්න...' }, { quoted: msg });
            try {
                const pingStart = performance.now();
                await axios.get('https://www.google.com');
                const ping = (performance.now() - pingStart).toFixed(0);

                const dlStart = performance.now();
                await axios.get('https://speed.cloudflare.com/__down?bytes=1048576', { responseType: 'arraybuffer' });
                const dlTime = (performance.now() - dlStart) / 1000; 
                const downloadSpeed = ((1 / dlTime) * 8).toFixed(2); 

                const ulStart = performance.now();
                const dummyBuffer = Buffer.alloc(1048576); 
                await axios.post('https://httpbin.org/post', dummyBuffer);
                const ulTime = (performance.now() - ulStart) / 1000;
                const uploadSpeed = ((1 / ulTime) * 8).toFixed(2); 

                const speedResult = `⚡ *𝚂𝙴𝚁𝚅𝙴𝚁 𝚂𝙿𝙴𝙴𝙳 𝚃𝙴𝚂𝚃 𝚁𝙴𝚂𝚄𝙻𝚃𝚂*\n\n` +
                                    `🔹 *Ping:* ${ping} ms\n` +
                                    `🔹 *Download Speed:* ${downloadSpeed} Mbps\n` +
                                    `🔹 *Upload Speed:* ${uploadSpeed} Mbps\n\n` +
                                    `_𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games_`;

                await sock.sendMessage(from, { text: speedResult }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ වේගය මැනීමේදී දෝෂයක් ඇති විය: ${err.message}` }, { quoted: msg });
            }
            return;
        }

        // 3. FILE DOWNLOAD & FORWARD TO GROUP (.sg)
        if (text.startsWith('.sg ')) {
            const commandBody = text.slice(4).trim();
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const links = commandBody.match(urlRegex) || [];
            let groupNameInput = commandBody.replace(urlRegex, '').trim().replace(/[\[\]]/g, '').trim();

            if (!groupNameInput || links.length === 0) {
                await sock.sendMessage(from, { text: '❌ නිවැරදිව ඇතුලත් කරන්න. නියැදිය: .sg RV Games https://link.com' }, { quoted: msg });
                return;
            }

            await sock.sendMessage(from, { text: `⏳ '${groupNameInput}' සමූහය සොයමින් පවතී...` }, { quoted: msg });

            try {
                const getGroups = await sock.groupFetchAllParticipating();
                const groups = Object.values(getGroups);
                const targetGroup = groups.find(g => g.subject.toLowerCase().trim() === groupNameInput.toLowerCase());

                if (!targetGroup) {
                    await sock.sendMessage(from, { text: `❌ '${groupNameInput}' නමින් සමූහයක් සොයාගත නොහැකි විය!` }, { quoted: msg });
                    return;
                }

                const jobStartTime = performance.now();

                for (let i = 0; i < links.length; i++) {
                    const link = links[i];
                    let tempFilePath = '';
                    
                    try {
                        let realFileName = `file_${Date.now()}.bin`;
                        const response = await axios({ method: 'get', url: link, responseType: 'stream', maxContentLength: Infinity, maxBodyLength: Infinity, timeout: 0 });

                        const contentDisposition = response.headers['content-disposition'];
                        if (contentDisposition) {
                            const fileNameMatch = contentDisposition.match(/filename\*?=["']?(?:UTF-8'')?([^"'\n;]+)["']?/i) || contentDisposition.match(/filename=["']?([^"'\n;]+)["']?/i);
                            if (fileNameMatch && fileNameMatch[1]) realFileName = decodeURIComponent(fileNameMatch[1]).replace(/["']/g, "").trim();
                        }

                        tempFilePath = path.join(tempFolder, `temp_${Date.now()}_${i}`);
                        const progressMsg = await sock.sendMessage(from, { text: `📥 *Downloading:* ${realFileName}\n📊 ▱▱▱▱▱▱▱▱▱▱ 0.0%\n📦 Calculating...` });

                        const totalBytes = parseInt(response.headers['content-length'], 10) || 0;
                        let downloadedBytes = 0;
                        let lastUpdateTime = Date.now();

                        response.data.on('data', async (chunk) => {
                            downloadedBytes += chunk.length;
                            const now = Date.now();
                            if (now - lastUpdateTime > 2500) {
                                lastUpdateTime = now;
                                const percentage = totalBytes ? ((downloadedBytes / totalBytes) * 100).toFixed(1) : 0;
                                const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
                                const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
                                const filledBlocks = totalBytes ? Math.round((percentage / 100) * 10) : 0;
                                const progressBar = '▰'.repeat(filledBlocks) + '▱'.repeat(10 - filledBlocks);

                                try { await sock.sendMessage(from, { text: `📥 *Downloading:* ${realFileName}\n📊 ${progressBar} ${percentage}%\n📦 ${downloadedMB}MB / ${totalMB}MB`, edit: progressMsg.key }); } catch (e) {}
                            }
                        });

                        const writer = fs.createWriteStream(tempFilePath);
                        response.data.pipe(writer);
                        await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });

                        const finalMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
                        
                        // Upload simulation
                        let uploadPercentage = 0;
                        let uploadInterval = setInterval(async () => {
                            if (uploadPercentage < 95) {
                                uploadPercentage += 10;
                                const progressBar = '▰'.repeat(Math.round(uploadPercentage/10)) + '▱'.repeat(10 - Math.round(uploadPercentage/10));
                                try { await sock.sendMessage(from, { text: `📤 *Uploading to Group:* ${realFileName}\n📊 ${progressBar} ${uploadPercentage}%\n📦 ${finalMB}MB`, edit: progressMsg.key }); } catch (e) {}
                            }
                        }, 2000);

                        try {
                            await sock.sendMessage(targetGroup.id, { document: { url: tempFilePath }, fileName: realFileName, mimetype: response.headers['content-type'] || 'application/octet-stream', caption: `*𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games*` });
                        } finally { clearInterval(uploadInterval); }

                        try { await sock.sendMessage(from, { text: `✅ *Success:* ${realFileName} uploaded!`, edit: progressMsg.key }); } catch (e) {}
                        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                    } catch (err) {
                        await sock.sendMessage(from, { text: `❌ Error on Part ${i+1}: ${err.message}` });
                        if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                    }
                }
                const timeTaken = ((performance.now() - jobStartTime) / 1000).toFixed(1);
                await sock.sendMessage(targetGroup.id, { text: `⚙️ *𝚁𝚅 𝙶𝙰𝙼𝙴𝚂 𝙳𝙾𝚆𝙽𝙻𝙾𝙰𝙳𝙴𝚁*\n\n✅ *Status:* Complete\n📦 *Total Parts:* ${links.length}\n⏱️ *Time:* ${timeTaken}s` });
            } catch (error) {
                await sock.sendMessage(from, { text: `❌ පද්ධති දෝෂයකි: ${error.message}` }, { quoted: msg });
            }
        }

        // 4. FILE DOWNLOAD & SEND TO INBOX (.si) - 🔒 INBOX ONLY
        if (text.startsWith('.si ')) {
            if (from.endsWith('@g.us')) {
                await sock.sendMessage(from, { text: '❌ *මෙම විධානය සමූහ (Group) තුළ භාවිතා කළ නොහැක!*\n\nකරුණාකර බොට්ගේ Inbox (Private Chat) එකට පැමිණ විධානය භාවිතා කරන්න.' }, { quoted: msg });
                return;
            }

            const commandBody = text.slice(4).trim();
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const links = commandBody.match(urlRegex) || [];

            if (links.length === 0) {
                await sock.sendMessage(from, { text: '❌ නියැදිය: .si https://link.com' }, { quoted: msg });
                return;
            }

            await sock.sendMessage(from, { text: `⏳ ගොනුව ඔබගේ Inbox එකට එවීමට සූදානම් කරමින් පවතී...` }, { quoted: msg });

            for (let i = 0; i < links.length; i++) {
                const link = links[i];
                let tempFilePath = '';

                try {
                    let realFileName = `file_${Date.now()}.bin`;
                    const response = await axios({ method: 'get', url: link, responseType: 'stream', maxContentLength: Infinity, maxBodyLength: Infinity, timeout: 0 });

                    const contentDisposition = response.headers['content-disposition'];
                    if (contentDisposition) {
                        const fileNameMatch = contentDisposition.match(/filename\*?=["']?(?:UTF-8'')?([^"'\n;]+)["']?/i) || contentDisposition.match(/filename=["']?([^"'\n;]+)["']?/i);
                        if (fileNameMatch && fileNameMatch[1]) realFileName = decodeURIComponent(fileNameMatch[1]).replace(/["']/g, "").trim();
                    }

                    tempFilePath = path.join(tempFolder, `temp_inbox_${Date.now()}`);
                    const progressMsg = await sock.sendMessage(from, { text: `📥 *Downloading to Inbox:* ${realFileName}\n📊 ▱▱▱▱▱▱▱▱▱▱ 0.0%` });

                    const totalBytes = parseInt(response.headers['content-length'], 10) || 0;
                    let downloadedBytes = 0;
                    let lastUpdateTime = Date.now();

                    response.data.on('data', async (chunk) => {
                        downloadedBytes += chunk.length;
                        const now = Date.now();
                        if (now - lastUpdateTime > 2500) {
                            lastUpdateTime = now;
                            const percentage = totalBytes ? ((downloadedBytes / totalBytes) * 100).toFixed(1) : 0;
                            const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
                            const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
                            const progressBar = '▰'.repeat(totalBytes ? Math.round((percentage / 100) * 10) : 0) + '▱'.repeat(10 - (totalBytes ? Math.round((percentage / 100) * 10) : 0));

                            try { await sock.sendMessage(from, { text: `📥 *Downloading to Inbox:* ${realFileName}\n📊 ${progressBar} ${percentage}%\n📦 ${downloadedMB}MB / ${totalMB}MB`, edit: progressMsg.key }); } catch (e) {}
                        }
                    });

                    const writer = fs.createWriteStream(tempFilePath);
                    response.data.pipe(writer);
                    await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });

                    const finalMB = (downloadedBytes / (1024 * 1024)).toFixed(1);

                    let uploadPercentage = 0;
                    let uploadInterval = setInterval(async () => {
                        if (uploadPercentage < 95) {
                            uploadPercentage += 15;
                            if (uploadPercentage > 95) uploadPercentage = 95;
                            const progressBar = '▰'.repeat(Math.round(uploadPercentage/10)) + '▱'.repeat(10 - Math.round(uploadPercentage/10));
                            try { await sock.sendMessage(from, { text: `📤 *Uploading to Inbox:* ${realFileName}\n📊 ${progressBar} ${uploadPercentage}%\n📦 ${finalMB}MB`, edit: progressMsg.key }); } catch (e) {}
                        }
                    }, 2000);

                    try {
                        await sock.sendMessage(from, { document: { url: tempFilePath }, fileName: realFileName, mimetype: response.headers['content-type'] || 'application/octet-stream', caption: `*𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games*` });
                    } finally { clearInterval(uploadInterval); }

                    try { await sock.sendMessage(from, { text: `✅ *Success:* ${realFileName} Sent to Inbox!`, edit: progressMsg.key }); } catch (e) {}
                    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                } catch (err) {
                    await sock.sendMessage(from, { text: `❌ Error: ${err.message}` });
                    if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                }
            }
        }

        // 5. FITGIRL GROUP COMMAND (.sgfg)
        if (text.startsWith('.sgfg ')) {
            const commandBody = text.slice(6).trim();
            const parts = commandBody.split(' ');
            const groupNameInput = parts[0]?.replace(/[\[\]]/g, '').trim();
            const gameNameInput = parts.slice(1).join(' ').trim();

            if (!groupNameInput || !gameNameInput) {
                await sock.sendMessage(from, { text: '❌ කරුණාකර නිවැරදිව ඇතුලත් කරන්න.\nනියැදිය: .sgfg RV_Games GTA' }, { quoted: msg });
                return;
            }

            await sock.sendMessage(from, { text: `🔍 FitGirl වෙතින් '${gameNameInput}' සොයමින් පවතී...` }, { quoted: msg });

            try {
                const getGroups = await sock.groupFetchAllParticipating();
                const groups = Object.values(getGroups);
                const targetGroup = groups.find(g => g.subject.toLowerCase().trim() === groupNameInput.toLowerCase());

                if (!targetGroup) {
                    await sock.sendMessage(from, { text: `❌ '${groupNameInput}' නමින් සමූහයක් සොයාගත නොහැකි විය!` }, { quoted: msg });
                    return;
                }

                const scrapeResult = await getFuckingFastLinks(gameNameInput);
                const finalMsg = `┏━━━━━━━━━━━━━━━━━━━━━━━┓\n   🎮 *𝙵𝙸𝚃𝙶𝙸𝚁𝙻 𝚇 𝙵𝚄𝙲𝙺𝙸𝙽𝙶𝙵𝙰𝚂𝚃* 🎮\n┗━━━━━━━━━━━━━━━━━━━━━━━┛\n\n${scrapeResult}\n\n_*𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games*_`;
                
                await sock.sendMessage(targetGroup.id, { text: finalMsg });
                await sock.sendMessage(from, { text: `✅ සියලුම Parts ලින්ක්ස් '${targetGroup.subject}' සමූහයට සාර්ථකව යවන ලදී!` }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(from, { text: `❌ දෝෂයකි: ${error.message}` }, { quoted: msg });
            }
        }

        // 6. FITGIRL INBOX COMMAND (.sifg) - 🔒 INBOX ONLY
        if (text.startsWith('.sifg ')) {
            if (from.endsWith('@g.us')) {
                await sock.sendMessage(from, { text: '❌ *මෙම විධානය සමූහ (Group) තුළ භාවිතා කළ නොහැක!*\n\nකරුණාකර බොට්ගේ Inbox එකට පැමිණ මෙම විධානය භාවිතා කරන්න.' }, { quoted: msg });
                return;
            }

            const gameNameInput = text.slice(6).trim();
            if (!gameNameInput) {
                await sock.sendMessage(from, { text: '❌ කරුණාකර ගේම් එකේ නම ඇතුලත් කරන්න.\nනියැදිය: .sifg GTA V' }, { quoted: msg });
                return;
            }

            await sock.sendMessage(from, { text: `🔍 FitGirl වෙතින් '${gameNameInput}' සොයමින් පවතී...` }, { quoted: msg });

            const scrapeResult = await getFuckingFastLinks(gameNameInput);
            const finalMsg = `┏━━━━━━━━━━━━━━━━━━━━━━━┓\n   🎮 *𝙵𝙸𝚃𝙶𝙸𝚁𝙻 𝚇 𝙵𝚄𝙲𝙺𝙸𝙽𝙶𝙵𝙰𝚂𝚃* 🎮\n┗━━━━━━━━━━━━━━━━━━━━━━━┛\n\n${scrapeResult}\n\n_*𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games*_`;
            
            await sock.sendMessage(from, { text: finalMsg }, { quoted: msg });
        }
    });
}

startBot();
