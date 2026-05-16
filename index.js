const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Railway එකේ දාන Session ID එක ෆයිල් එකක් බවට පත් කිරීම
if (process.env.SESSION_ID) {
    if (!fs.existsSync('./session')) {
        fs.mkdirSync('./session');
    }
    try {
        // Base64 කරපු සෙෂන් එකක් නම් එය ඩිකෝඩ් කර creds.json ලෙස සේව් කරයි
        const decryptedCreds = Buffer.from(process.env.SESSION_ID, 'base64').toString('utf-8');
        fs.writeFileSync('./session/creds.json', decryptedCreds);
    } catch (e) {
        // සාමාන්‍ය JSON එකක් නම් කෙලින්ම සේව් කරයි
        fs.writeFileSync('./session/creds.json', process.env.SESSION_ID);
    }
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('සම්බන්ධතාවය බිඳ වැටුණා. නැවත උත්සාහ කරයි...', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('WhatsApp Bot සාර්ථකව සම්බන්ධ වුණා!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        // මැසේජ් එකේ ඇති ටෙක්ස්ට් එක ලබාගැනීම
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        
        // විධානය පරීක්ෂා කිරීම (.sg වලින් පටන් ගන්නේ නම්)
        if (text.startsWith('.sg ')) {
            const args = text.slice(4).trim().split(/\s+/);
            if (args.length < 2) {
                await sock.sendMessage(msg.key.remoteJid, { text: '❌ කරුණාකර නිවැරදිව ඇතුලත් කරන්න.\nනියැදිය: .sg [GroupName] [Link1] [Link2]' }, { quoted: msg });
                return;
            }

            const groupNameInput = args[0].replace('[', '').replace(']', '');
            const links = args.slice(1).map(l => l.replace('[', '').replace(']', ''));

            await sock.sendMessage(msg.key.remoteJid, { text: `⏳ '${groupNameInput}' සමූහය සොයමින් සහ ගොනු ඩවුන්ලෝඩ් වෙමින් පවතී...` }, { quoted: msg });

            try {
                // බොට් ඉන්න සියලුම ගෲප් ලැයිස්තුව ලබා ගැනීම
                const getGroups = await sock.groupFetchAllParticipating();
                const groups = Object.values(getGroups);
                
                // නම ගැලපෙන ගෲප් එක සෙවීම
                const targetGroup = groups.find(g => g.subject.toLowerCase() === groupNameInput.toLowerCase());

                if (!targetGroup) {
                    await sock.sendMessage(msg.key.remoteJid, { text: `❌ '${groupNameInput}' නමින් සමූහයක් (Group) සොයාගත නොහැකි විය!` }, { quoted: msg });
                    return;
                }

                // ලින්ක් එකින් එක ඩවුන්ලෝඩ් කර ගෲප් එකට යැවීම
                for (let i = 0; i < links.length; i++) {
                    const link = links[i];
                    try {
                        await sock.sendMessage(msg.key.remoteJid, { text: `📥 ඩවුන්ලෝඩ් වෙමින් පවතී (${i + 1}/${links.length}): ${link}` });

                        // ලින්ක් එකෙන් ෆයිල් එක බෆර් එකක් ලෙස ලබා ගැනීම
                        const response = await axios({
                            method: 'get',
                            url: link,
                            responseType: 'arraybuffer'
                        });

                        const buffer = Buffer.from(response.data, 'binary');
                        
                        // ලින්ක් එකෙන් ෆයිල් එකේ නම වෙන් කරගැනීම
                        const fileName = path.basename(new URL(link).pathname) || `file_${Date.now()}`;

                        // ගෲප් එකට ෆයිල් එක සෙන්ඩ් කිරීම
                        await sock.sendMessage(targetGroup.id, {
                            document: buffer,
                            fileName: fileName,
                            mimetype: response.headers['content-type'] || 'application/octet-stream'
                        });

                    } catch (err) {
                        await sock.sendMessage(msg.key.remoteJid, { text: `❌ මෙම ලින්ක් එක වැඩ කරන්නේ නැත: ${link}\nError: ${err.message}` });
                    }
                }

                await sock.sendMessage(msg.key.remoteJid, { text: '✅ සියලුම ගොනු සාර්ථකව සමූහයට යවන ලදී!' }, { quoted: msg });

            } catch (error) {
                console.error(error);
                await sock.sendMessage(msg.key.remoteJid, { text: `❌ පද්ධති දෝෂයකි: ${error.message}` }, { quoted: msg });
            }
        }
    });
}

startBot();
