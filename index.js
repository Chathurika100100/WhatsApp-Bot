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

// Global Memory Session to hold FitGirl search results
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

// 🔍 FITGIRL FUNCTIONS: Search games
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

// 🎯 EXTRACT RAW FUCKINGFAST LINKS (Deep Scraping for Paste Pages)
async function getFitGirlLinks(pageUrl) {
    try {
        const response = await axios.get(pageUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const $ = cheerio.load(response.data);
        let mirrors = [];

        // 1. මුලින්ම ප්‍රධාන පේජ් එකේ තියෙන FuckingFast ලින්ක්ස් ටික එකතු කරගන්නවා
        $('div.entry-content ul li a').each((i, el) => {
            const href = $(el).attr('href');
            if (href && href.includes('fuckingfast.co')) {
                mirrors.push(href);
            }
        });

        // 2. වැදගත්ම කොටස: එකතු කරගත් ලින්ක් එකක් "paste.fitgirl-repacks.site" වගේ එකක් නම්, ඒක ඇතුළට ගිහින් සැබෑ ලින්ක්ස් ටික හාරලා ගන්නවා
        let finalPartLinks = [];
        for (let link of mirrors) {
            if (link.includes('paste.fitgirl-repacks.site') || link.includes('/?')) {
                try {
                    const pasteRes = await axios.get(link, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
                    const $paste = cheerio.load(pasteRes.data);
                    
                    $paste('a').each((j, elElement) => {
                        const directHref = $paste(elElement).attr('href');
                        // මෙතනදී .rar, .zip හෝ fuckingfast එකේ download ලින්ක්ස් ටික වෙන් කරගන්නවා
                        if (directHref && directHref.includes('fuckingfast.co') && !directHref.includes('paste.fitgirl')) {
                            if (!finalPartLinks.includes(directHref)) {
                                finalPartLinks.push(directHref);
                            }
                        }
                    });
                } catch (err) {
                    console.error("Error reading paste page:", err.message);
                }
            } else {
                if (!finalPartLinks.includes(link)) {
                    finalPartLinks.push(link);
                }
            }
        }

        // Setup.exe එක විතරක් තියෙන ලින්ක් එක අයින් කරලා, .part001.rar වගේ තියෙන සැබෑ ගේම් ෆයිල්ස් විතරක් ඉතිරි කරගන්නවා
        return finalPartLinks.filter(l => !l.toLowerCase().includes('setup_proper.exe') && !l.toLowerCase().includes('setup.exe'));
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
                                 `🎮 *𝙵𝙸𝚃𝙶𝙸𝚁𝙻 𝙲𝙾𝙼𝙼𝙰𝙽𝙳𝚂:*\n` +
                                 `👉 🔍 \`.fitgirl [GameName]\` - ගේම් සර්ච් කිරීමට.\n` +
                                 `👉 📦 \`.fgparts [Number]\` - කෙලින්ම සියලුම Parts මෙම චැට් එකටම ඩවුන්ලෝඩ් කර ගැනීමට.\n\n` +
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

                await sock.sendMessage(from, { text: `⏳ ඩවුන්ලෝඩ් එක සූදානම් කරමින් පවතී...` }, { quoted: msg });

                for (let i = 0; i < links.length; i++) {
                    let tempFilePath = '';
                    try {
                        const finalUrl = await resolveDirectLink(links[i]);
                        let realFileName = `file_${Date.now()}.bin`;
                        
                        const response = await axios({ method: 'get', url: finalUrl, responseType: 'stream', timeout: 0 });
                        
                        const cd = response.headers['content-disposition'];
                        if (cd) {
                            const fm = cd.match(/filename\*?=["']?(?:UTF-8'')?([^"'\n;]+)["']?/i) || cd.match(/filename=["']?([^"'\n;]+)["']?/i);
                            if (fm && fm[1]) realFileName = decodeURIComponent(fm[1]).replace(/["']/g, "").trim();
                        }

                        tempFilePath = path.join(tempFolder, `temp_${Date.now()}_${i}`);
                        const writer = fs.createWriteStream(tempFilePath);
                        response.data.pipe(writer);
                        await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });

                        await sock.sendMessage(targetGroup.id, { 
                            document: { url: tempFilePath }, 
                            fileName: realFileName, 
                            mimetype: response.headers['content-type'] || 'application/octet-stream' 
                        });
                        
                        await sock.sendMessage(from, { text: `✅ ෆයිල් එක ${groupNameInput} ගෘප් එකට යැව්වා!` });
                    } catch (e) {
                        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
                    } finally {
                        if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
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

                await sock.sendMessage(from, { text: `⏳ ඩවුන්ලෝඩ් එක ආරම්භ විය...` }, { quoted: msg });

                for (let link of links) {
                    let tempFilePath = '';
                    try {
                        const finalUrl = await resolveDirectLink(link);
                        let realFileName = `file_${Date.now()}.bin`;

                        const response = await axios({ method: 'get', url: finalUrl, responseType: 'stream', timeout: 0 });
                        
                        const cd = response.headers['content-disposition'];
                        if (cd) {
                            const fm = cd.match(/filename\*?=["']?(?:UTF-8'')?([^"'\n;]+)["']?/i) || cd.match(/filename=["']?([^"'\n;]+)["']?/i);
                            if (fm && fm[1]) realFileName = decodeURIComponent(fm[1]).replace(/["']/g, "").trim();
                        }

                        tempFilePath = path.join(tempFolder, `temp_inbox_${Date.now()}`);
                        const writer = fs.createWriteStream(tempFilePath);
                        response.data.pipe(writer);
                        await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });

                        await sock.sendMessage(from, { 
                            document: { url: tempFilePath }, 
                            fileName: realFileName, 
                            mimetype: response.headers['content-type'] || 'application/octet-stream' 
                        });
                    } catch (e) {
                        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
                    } finally {
                        if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                    }
                }
            }

            // 🛑 STEP 1: FITGIRL SEARCH (.fitgirl gta v)
            if (command === 'fitgirl') {
                const query = args.join(' ').trim();
                if (!query) return await sock.sendMessage(from, { text: '❌ භාවිතය: .fitgirl [Game Name]' }, { quoted: msg });

                await sock.sendMessage(from, { text: `🔍 *${query}* සර්ච් කරමින් පවතී...` }, { quoted: msg });
                const results = await searchFitGirl(query);
                
                if (results.length === 0) return await sock.sendMessage(from, { text: '❌ කිසිදු ගේම් එකක් හමු නොවිය.' }, { quoted: msg });

                userSessions[from] = results; 
                let responseText = `🎮 *Search Results:* _${query}_\n\n`;
                results.forEach((res, index) => { responseText += `*${index + 1}.* ${res.title}\n`; });
                responseText += `\n👉 සියලුම Parts කෙලින්ම මෙතනටම ගෙන්න ගන්න: \n*.fgparts <number>* (උදා: .fgparts 1)`;
                
                await sock.sendMessage(from, { text: responseText }, { quoted: msg });
                return;
            }

            // 🛑 STEP 2: AUTOMATIC DOWNLOAD & SEND ALL PARTS DIRECTLY (.fgparts 1)
            if (command === 'fgparts') {
                const index = parseInt(args[0]) - 1;
                if (!userSessions[from] || isNaN(index) || !userSessions[from][index]) {
                    return await sock.sendMessage(from, { text: '❌ කරුණාකර මුලින්ම .fitgirl සර්ච් කරන්න.' }, { quoted: msg });
                }

                const selectedGame = userSessions[from][index];
                await sock.sendMessage(from, { text: `⏳ *${selectedGame.title}* හි FuckingFast ලින්ක්ස් පරීක්ෂා කරමින් පවතී...` }, { quoted: msg });
                
                // Deep scraped links list
                const links = await getFitGirlLinks(selectedGame.link);
                if (links.length === 0) return await sock.sendMessage(from, { text: '❌ මෙම ගේම් එක සඳහා FuckingFast ලින්ක්ස් හමු නොවිය.' }, { quoted: msg });

                await sock.sendMessage(from, { text: `📦 මුළු ෆයිල්ස් (Parts) ප්‍රමාණය: ${links.length}\n📥 සියල්ලම ස්වයංක්‍රීයව ඩවුන්ලෝඩ් වී මෙම චැට් එකටම ලැබීම ආරම්භ විය...` }, { quoted: msg });

                for (let i = 0; i < links.length; i++) {
                    let tempFilePath = '';
                    try {
                        const finalUrl = await resolveDirectLink(links[i]);
                        let realFileName = `part_${i + 1}_${Date.now()}.bin`;
                        
                        const response = await axios({ method: 'get', url: finalUrl, responseType: 'stream', timeout: 0 });
                        
                        const cd = response.headers['content-disposition'];
                        if (cd) {
                            const fm = cd.match(/filename\*?=["']?(?:UTF-8'')?([^"'\n;]+)["']?/i) || cd.match(/filename=["']?([^"'\n;]+)["']?/i);
                            if (fm && fm[1]) realFileName = decodeURIComponent(fm[1]).replace(/["']/g, "").trim();
                        }

                        tempFilePath = path.join(tempFolder, `temp_auto_${Date.now()}_${i}`);
                        const writer = fs.createWriteStream(tempFilePath);
                        response.data.pipe(writer);
                        await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });

                        await sock.sendMessage(from, { 
                            document: { url: tempFilePath }, 
                            fileName: realFileName, 
                            mimetype: response.headers['content-type'] || 'application/octet-stream' 
                        });

                    } catch (e) {
                        await sock.sendMessage(from, { text: `❌ Part ${i + 1} ඩවුන්ලෝඩ් කිරීමේදී දෝෂයක් ඇතිවිය: ${e.message}` });
                    } finally {
                        if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                    }
                }

                await sock.sendMessage(from, { text: `✅ *${selectedGame.title}* හි සියලුම ෆයිල්ස් එවා අවසන්!` });
                return;
            }

        } catch (globalErr) {
            console.error("Error in msg loop:", globalErr);
        }
    });
}

startBot();
