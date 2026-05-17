const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

// Railway හෝ Koyeb එකේ දාන Session ID එක ෆයිල් එකක් බවට පත් කිරීම
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

// Temporary ෆෝල්ඩර් එක නිර්මාණය කිරීම (ලොකු ෆයිල් තියාගන්න)
const tempFolder = './temp_downloads';
if (!fs.existsSync(tempFolder)) {
    fs.mkdirSync(tempFolder);
}

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
            console.log(`සම්බන්ධතාවය බිඳ වැටුණා (Status: ${statusCode}). නැවත උත්සාහ කරයි...`, shouldReconnect);
            if (shouldReconnect) {
                setTimeout(() => startBot(), 5000);
            }
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
            const menuText = `🤖 *𝚁𝚅 𝙶𝙰𝙼𝙴𝚂 𝚆𝙷𝙰𝚃𝚂𝙰𝙿𝙿 𝙱𝙾転* 🤖\n\n` +
                             `👋 ආයුබෝවන්! මෙන්න මගේ විධානයන් (Commands) ලැයිස්තුව:\n\n` +
                             `⚙️ *ප්‍රධාන විධානයන්:*\n` +
                             `👉 📄 \`.menu\` - මෙම මෙනුව ලබා ගැනීමට.\n` +
                             `👉 ⚡ \`.speed\` - සර්වර් එකේ වේගය (Speed Test) බැලීමට.\n` +
                             `👉 📥 \`.sg [GroupName] [Link]\` - ලින්ක් මඟින් ගොනු ඩවුන්ලෝඩ් කර අදාළ සමූහයට (Group) යැවීමට.\n` +
                             `👉 📥 \`.si [Link]\` - ලින්ක් මඟින් ගොනු ඩවුන්ලෝඩ් කර ඔබගේ Inbox එකටම ලබා ගැනීමට (Inbox Only).\n\n` +
                             `_𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games_`;
                             
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

                // Download Speed Test
                const dlStart = performance.now();
                await axios.get('https://speed.cloudflare.com/__down?bytes=1048576', { responseType: 'arraybuffer' });
                const dlEnd = performance.now();
                const dlTime = (dlEnd - dlStart) / 1000; 
                const downloadSpeed = ((1 / dlTime) * 8).toFixed(2); 

                // Upload Speed Test
                const ulStart = performance.now();
                const dummyBuffer = Buffer.alloc(1048576); 
                await axios.post('https://httpbin.org/post', dummyBuffer);
                const ulEnd = performance.now();
                const ulTime = (ulEnd - ulStart) / 1000;
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
            
            let groupNameInput = commandBody.replace(urlRegex, '').trim();
            groupNameInput = groupNameInput.replace(/[\[\]]/g, '').trim();

            if (!groupNameInput || links.length === 0) {
                await sock.sendMessage(from, { text: '❌ කරුණාකර නිවැරදිව ඇතුලත් කරන්න.\nනියැදිය: .sg RV Games https://link1.com' }, { quoted: msg });
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
                const totalLinks = links.length;

                for (let i = 0; i < totalLinks; i++) {
                    const link = links[i];
                    let tempFilePath = '';
                    
                    try {
                        let realFileName = `file_${Date.now()}.bin`;
                        try {
                            const parsedUrl = new URL(link);
                            let baseName = path.basename(parsedUrl.pathname);
                            if (baseName) {
                                realFileName = decodeURIComponent(baseName).split('?')[0].split('#')[0];
                            }
                        } catch (e) {}

                        const response = await axios({ method: 'get', url: link, responseType: 'stream', maxContentLength: Infinity, maxBodyLength: Infinity, timeout: 0 });

                        const contentDisposition = response.headers['content-disposition'];
                        if (contentDisposition) {
                            const fileNameMatch = contentDisposition.match(/filename\*?=["']?(?:UTF-8'')?([^"'\n;]+)["']?/i);
                            if (fileNameMatch && fileNameMatch[1]) {
                                realFileName = decodeURIComponent(fileNameMatch[1]);
                            } else {
                                const fallbackMatch = contentDisposition.match(/filename=["']?([^"'\n;]+)["']?/i);
                                if (fallbackMatch && fallbackMatch[1]) {
                                    realFileName = fallbackMatch[1];
                                }
                            }
                        }
                        realFileName = realFileName.replace(/["']/g, "").trim();

                        const localSafeName = `temp_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                        tempFilePath = path.join(tempFolder, localSafeName);

                        const initialText = `📥 *Downloading:* ${realFileName}\n📊 ▱▱▱▱▱▱▱▱▱▱ 0.0%\n📦 0.0MB / Calculating...`;
                        const progressMsg = await sock.sendMessage(from, { text: initialText });
                        const msgKey = progressMsg.key;

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

                                const progressText = `📥 *Downloading:* ${realFileName}\n📊 ${progressBar} ${totalBytes ? percentage + '%' : 'Streaming...'}\n📦 ${downloadedMB}MB / ${totalBytes ? totalMB + 'MB' : 'Unknown'}`;
                                try { await sock.sendMessage(from, { text: progressText, edit: msgKey }); } catch (e) {}
                            }
                        });

                        const writer = fs.createWriteStream(tempFilePath);
                        response.data.pipe(writer);
                        await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });

                        const finalMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
                        try { await sock.sendMessage(from, { text: `📥 *Downloading:* ${realFileName}\n📊 ▰▰▰▰▰▰▰▰▰▰ 100.0%\n📦 ${finalMB}MB / ${finalMB}MB`, edit: msgKey }); } catch (e) {}

                        // Upload Simulation
                        let uploadPercentage = 0;
                        let uploadInterval = setInterval(async () => {
                            if (uploadPercentage < 95) {
                                uploadPercentage += Math.floor(Math.random() * 8) + 4;
                                if (uploadPercentage > 95) uploadPercentage = 95;
                                const uploadedMB = ((uploadPercentage / 100) * finalMB).toFixed(1);
                                const filledBlocks = Math.round((uploadPercentage / 100) * 10);
                                const progressBar = '▰'.repeat(filledBlocks) + '▱'.repeat(10 - filledBlocks);
                                try { await sock.sendMessage(from, { text: `📤 *Uploading:* ${realFileName}\n📊 ${progressBar} ${uploadPercentage.toFixed(1)}%\n📦 ${uploadedMB}MB / ${finalMB}MB`, edit: msgKey }); } catch (e) {}
                            }
                        }, 2500);

                        try {
                            await sock.sendMessage(targetGroup.id, { document: { url: tempFilePath }, fileName: realFileName, mimetype: response.headers['content-type'] || 'application/octet-stream', caption: `*𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games*` });
                        } finally { clearInterval(uploadInterval); }

                        try { await sock.sendMessage(from, { text: `📤 *Uploading:* ${realFileName}\n📊 ▰▰▰▰▰▰▰▰▰▰ 100.0%\n📦 ${finalMB}MB / ${finalMB}MB`, edit: msgKey }); } catch (e) {}

                        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                    } catch (err) {
                        await sock.sendMessage(from, { text: `❌ දෝෂයකි (Link ${i+1}): ${err.message}` });
                        if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                    }
                }

                const timeTaken = ((performance.now() - jobStartTime) / 1000).toFixed(1);
                await sock.sendMessage(targetGroup.id, { text: `┏━━━━━━━━━━━━━━━━━━━━━━━┓\n      ⚙️ *𝚁𝚅 𝙶𝙰𝙼𝙴𝚂* ⚙️\n┗━━━━━━━━━━━━━━━━━━━━━━━┛\n\n┌────────────────────────\n│ ✅ *Status:* Done\n│ 📦 *Total Parts:* ${totalLinks}\n│ ⏱️ *Time Taken:* ${timeTaken}s\n└────────────────────────\n\n_*𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games*_` });
                await sock.sendMessage(from, { text: `✅ සියලුම ගොනු සහ සාරාංශය (Summary) '${targetGroup.subject}' සමූහයට සාර්ථකව යවන ලදී!` }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(from, { text: `❌ පද්ධති දෝෂයකි: ${error.message}` }, { quoted: msg });
            }
        }

        // 4. FILE DOWNLOAD & SEND TO INBOX (.si) - 🔒 INBOX ONLY RESTRICTION
        if (text.startsWith('.si ')) {
            // 🚫 මෙතනදී මැසේජ් එක ආවේ Group එකකින්ද කියා පරීක්ෂා කරයි (@g.us වලින් ඉවර වෙන්නේ ගෲප් ජේ.අයි.ඩී වේ)
            if (from.endsWith('@g.us')) {
                await sock.sendMessage(from, { text: '❌ *මෙම විධානය සමූහ (Group) තුළ භාවිතා කළ නොහැක!*\n\nෆයිල් එක කෙලින්ම ඔබගේ Inbox එකට ලබා ගැනීමට කරුණාකර බොට්ගේ Inbox (Private Chat) එකට පැමිණ මෙම විධානය භාවිතා කරන්න.' }, { quoted: msg });
                return;
            }

            const commandBody = text.slice(4).trim();
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const links = commandBody.match(urlRegex) || [];

            if (links.length === 0) {
                await sock.sendMessage(from, { text: '❌ කරුණාකර නිවැරදිව ලින්ක් එක ඇතුලත් කරන්න.\nනියැදිය: .si https://link1.com' }, { quoted: msg });
                return;
            }

            await sock.sendMessage(from, { text: `⏳ ගොනුව ඔබගේ Inbox එකට එවීමට සූදානම් කරමින් පවතී...` }, { quoted: msg });

            const jobStartTime = performance.now();
            const totalLinks = links.length;

            for (let i = 0; i < totalLinks; i++) {
                const link = links[i];
                let tempFilePath = '';

                try {
                    let realFileName = `file_${Date.now()}.bin`;
                    try {
                        const parsedUrl = new URL(link);
                        let baseName = path.basename(parsedUrl.pathname);
                        if (baseName) {
                            realFileName = decodeURIComponent(baseName).split('?')[0].split('#')[0];
                        }
                    } catch (e) {}

                    const response = await axios({ method: 'get', url: link, responseType: 'stream', maxContentLength: Infinity, maxBodyLength: Infinity, timeout: 0 });

                    const contentDisposition = response.headers['content-disposition'];
                    if (contentDisposition) {
                        const fileNameMatch = contentDisposition.match(/filename\*?=["']?(?:UTF-8'')?([^"'\n;]+)["']?/i);
                        if (fileNameMatch && fileNameMatch[1]) {
                            realFileName = decodeURIComponent(fileNameMatch[1]);
                        } else {
                            const fallbackMatch = contentDisposition.match(/filename=["']?([^"'\n;]+)["']?/i);
                            if (fallbackMatch && fallbackMatch[1]) {
                                realFileName = fallbackMatch[1];
                            }
                        }
                    }
                    realFileName = realFileName.replace(/["']/g, "").trim();

                    const localSafeName = `temp_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                    tempFilePath = path.join(tempFolder, localSafeName);

                    // 📊 DOWNLOAD PROGRESS
                    const initialText = `📥 *Downloading to Inbox:* ${realFileName}\n📊 ▱▱▱▱▱▱▱▱▱▱ 0.0%\n📦 0.0MB / Calculating...`;
                    const progressMsg = await sock.sendMessage(from, { text: initialText });
                    const msgKey = progressMsg.key;

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

                            const progressText = `📥 *Downloading to Inbox:* ${realFileName}\n📊 ${progressBar} ${totalBytes ? percentage + '%' : 'Streaming...'}\n📦 ${downloadedMB}MB / ${totalBytes ? totalMB + 'MB' : 'Unknown'}`;
                            try { await sock.sendMessage(from, { text: progressText, edit: msgKey }); } catch (e) {}
                        }
                    });

                    const writer = fs.createWriteStream(tempFilePath);
                    response.data.pipe(writer);
                    await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });

                    const finalMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
                    try { await sock.sendMessage(from, { text: `📥 *Downloading to Inbox:* ${realFileName}\n📊 ▰▰▰▰▰▰▰▰▰▰ 100.0%\n📦 ${finalMB}MB / ${finalMB}MB`, edit: msgKey }); } catch (e) {}

                    // 📊 UPLOAD PROGRESS
                    let uploadPercentage = 0;
                    let uploadInterval = setInterval(async () => {
                        if (uploadPercentage < 95) {
                            uploadPercentage += Math.floor(Math.random() * 8) + 4;
                            if (uploadPercentage > 95) uploadPercentage = 95;
                            const uploadedMB = ((uploadPercentage / 100) * finalMB).toFixed(1);
                            const filledBlocks = Math.round((uploadPercentage / 100) * 10);
                            const progressBar = '▰'.repeat(filledBlocks) + '▱'.repeat(10 - filledBlocks);
                            try { await sock.sendMessage(from, { text: `📤 *Uploading to Inbox:* ${realFileName}\n📊 ${progressBar} ${uploadPercentage.toFixed(1)}%\n📦 ${uploadedMB}MB / ${finalMB}MB`, edit: msgKey }); } catch (e) {}
                        }
                    }, 2500);

                    try {
                        // කෙලින්ම Inbox එකටම යැවීම (from යනු දැනටමත් Inbox JID එකයි)
                        await sock.sendMessage(from, { document: { url: tempFilePath }, fileName: realFileName, mimetype: response.headers['content-type'] || 'application/octet-stream', caption: `*𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games*` });
                    } finally { clearInterval(uploadInterval); }

                    try { await sock.sendMessage(from, { text: `📤 *Uploading to Inbox:* ${realFileName}\n📊 ▰▰▰▰▰▰▰▰▰▰ 100.0%\n📦 ${finalMB}MB / ${finalMB}MB`, edit: msgKey }); } catch (e) {}

                    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                } catch (err) {
                    await sock.sendMessage(from, { text: `❌ දෝෂයකි (Link ${i+1}): ${err.message}` });
                    if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                }
            }

            const timeTaken = ((performance.now() - jobStartTime) / 1000).toFixed(1);
            
            // සාරාංශය Inbox එකට යැවීම
            await sock.sendMessage(from, { text: `┏━━━━━━━━━━━━━━━━━━━━━━━┓\n      ⚙️ *𝚁𝚅 𝙶𝙰𝙼𝙴𝚂* ⚙️\n┗━━━━━━━━━━━━━━━━━━━━━━━┛\n\n┌────────────────────────\n│ ✅ *Status:* Sent to Inbox\n│ 📦 *Total Parts:* ${totalLinks}\n│ ⏱️ *Time Taken:* ${timeTaken}s\n└────────────────────────\n\n_*𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈  RV Games*_` });
        }
    });
}

startBot();
