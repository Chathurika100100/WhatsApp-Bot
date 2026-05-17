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

// 🎯 FUCKINGFAST FILTER FUNCTION
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
            
            // FuckingFast ලින්ක්ස් පමණක් තෝරා ගැනීම
            if (link && (link.includes('fuckingfast') || text.includes('FuckingFast') || text.includes('Fucking Fast'))) {
                let cleanText = text.replace('Click to show direct links', '').trim();
                mirrors.push(`🚀 *${cleanText}*:\n${link}`);
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
        if (connection === 'close') {
            const statusCode = lastDisconnect.error?.output?.statusCode || lastDisconnect.error?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
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
                responseText += `\n👉 ලින්ක්ස් සඳහා: *.fgparts <number>* (උදා: .fgparts 1)`;
                
                await sock.sendMessage(from, { text: responseText }, { quoted: msg });
                return;
            }

            // 🛑 STEP 2: GET ONLY FUCKINGFAST LINKS (.fgparts 1)
            if (command === 'fgparts') {
                const index = parseInt(args[0]) - 1;
                if (!userSessions[from] || isNaN(index) || !userSessions[from][index]) {
                    return await sock.sendMessage(from, { text: '❌ කරුණාකර මුලින්ම .fitgirl සර්ච් කරන්න.' }, { quoted: msg });
                }

                const selectedGame = userSessions[from][index];
                await sock.sendMessage(from, { text: `⏳ *FuckingFast* ලින්ක්ස් සොයමින් පවතී...` }, { quoted: msg });
                const links = await getFitGirlLinks(selectedGame.link);
                
                if (links.length === 0) return await sock.sendMessage(from, { text: '❌ මෙම ගේම් එක සඳහා FuckingFast ලින්ක්ස් හමු නොවිය.' }, { quoted: msg });

                let responseText = `🚀 *FUCKINGFAST LINKS FOR:* ${selectedGame.title}\n\n` + links.join('\n\n');
                await sock.sendMessage(from, { text: responseText }, { quoted: msg });
                return;
            }

            // 📥 DOWNLOAD TO GROUP (.sg GroupName Link)
            if (command === 'sg') {
                const fullBody = args.join(' ');
                const urlRegex = /(https?:\/\/[^\s]+)/g;
                const links = fullBody.match(urlRegex) || [];
                let groupNameInput = fullBody.replace(urlRegex, '').trim().replace(/[\[\]]/g, '').trim();

                if (!groupNameInput || links.length === 0) return await sock.sendMessage(from, { text: '❌ භාවිතය: .sg [Group Name] [Link]' }, { quoted: msg });

                const getGroups = await sock.groupFetchAllParticipating();
                const targetGroup = Object.values(getGroups).find(g => g.subject.toLowerCase().trim() === groupNameInput.toLowerCase());

                if (!targetGroup) return await sock.sendMessage(from, { text: `❌ '${groupNameInput}' සමූහය සොයාගත නොහැක!` }, { quoted: msg });

                await sock.sendMessage(from, { text: `⏳ ඩවුන්ලෝඩ් එක ආරම්භ විය...` }, { quoted: msg });

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

                        // GROUP එකට යවන කොටස (කැප්ෂන් නැත, ෆයිල් එක පමණි)
                        await sock.sendMessage(targetGroup.id, { 
                            document: { url: tempFilePath }, 
                            fileName: realFileName, 
                            mimetype: response.headers['content-type'] || 'application/octet-stream' 
                        });
                        
                        await sock.sendMessage(from, { text: `✅ ෆයිල් එක ගෘප් එකට යැව්වා!` });
                    } catch (e) {
                        await sock.sendMessage(from, { text: `❌ Error: ${e.message}` });
                    } finally {
                        if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                    }
                }
            }

            // 🔐 DOWNLOAD TO INBOX (.si Link)
            if (command === 'si') {
                if (from.endsWith('@g.us')) return await sock.sendMessage(from, { text: '❌ මෙය Inbox එකේ පමණක් ක්‍රියා කරයි!' }, { quoted: msg });

                const links = args.join(' ').match(/(https?:\/\/[^\s]+)/g) || [];
                if (links.length === 0) return await sock.sendMessage(from, { text: '❌ භාවිතය: .si [Link]' }, { quoted: msg });

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

                        // INBOX එකට යවන කොටස (කැප්ෂන් නැත, ෆයිල් එක පමණි)
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

        } catch (globalErr) {
            console.error("Error in msg loop:", globalErr);
        }
    });
}

startBot();
