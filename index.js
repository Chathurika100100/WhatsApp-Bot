import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import 'dotenv/config';
import axios from 'axios';
import speedTest from 'speedtest-net';

async function startBot() {
    const sessionId = process.env.SESSION_ID;
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message) return;

        // මැසේජ් එකේ text එක ලබා ගැනීම
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        if (!text.startsWith('.')) return; // '.' වලින් පටන් ගන්නේ නැත්නම් අතහැර දමන්න

        const senderJid = msg.key.participant || msg.key.remoteJid; // කමාන්ඩ් එක දාපු කෙනාගේ JID එක
        const isGroup = msg.key.remoteJid.endsWith('@g.us');
        
        // URL හොයාගන්න Regex එක
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const urls = text.match(urlRegex) || [];

        // 1. .si Command එක (Inbox එකට යැවීම)
        if (text.startsWith('.si ')) {
            if (urls.length === 0) {
                return await sock.sendMessage(msg.key.remoteJid, { text: 'කරුණාකර valid link එකක් ලබා දෙන්න. Ex: .si [link]' }, { quoted: msg });
            }

            await sock.sendMessage(msg.key.remoteJid, { text: '📥 Links ඩවුන්ලෝඩ් වෙමින් පවතී. කරුණාකර රැඳී සිටින්න...' }, { quoted: msg });

            for (let url of urls) {
                try {
                    // කෙලින්ම URL එක හරහා File එක යැවීම (RAM එක ඉතිරි කරගන්න)
                    await sock.sendMessage(senderJid, { 
                        document: { url: url }, 
                        mimetype: 'application/octet-stream', 
                        fileName: 'downloaded_file' // ඔයාට ඕන නම් axios වලින් headers අරන් හරි නම ගන්නත් පුළුවන්
                    });
                    
                    if (isGroup) {
                         await sock.sendMessage(msg.key.remoteJid, { text: '✅ ෆයිල් එක ඔයාගේ Inbox එකට එව්වා!' }, { quoted: msg });
                    }
                } catch (error) {
                    await sock.sendMessage(senderJid, { text: `❌ මේ ලින්ක් එකෙන් ෆයිල් එක ගන්න බැරි වුණා: ${url}` });
                }
            }
        }

        // 2. .sg Command එක (Group එකට යැවීම)
        else if (text.startsWith('.sg ')) {
            if (urls.length === 0) {
                return await sock.sendMessage(msg.key.remoteJid, { text: 'කරුණාකර valid link එකක් ලබා දෙන්න. Ex: .sg Group Name [link]' }, { quoted: msg });
            }

            // Command එකෙන් Links ටික අයින් කරලා ඉතිරි ටිකෙන් Group Name එක වෙන් කරගැනීම (Spaces තිබුණත් වැඩ කරයි)
            let groupName = text.replace('.sg ', '');
            urls.forEach(u => groupName = groupName.replace(u, ''));
            groupName = groupName.trim().toLowerCase();

            if (!groupName) {
                return await sock.sendMessage(msg.key.remoteJid, { text: 'කරුණාකර Group එකේ නම ඇතුළත් කරන්න.' }, { quoted: msg });
            }

            await sock.sendMessage(msg.key.remoteJid, { text: `🔍 '${groupName}' ගෲප් එක හොයමින් පවතී...` });

            try {
                // බොට් ඉන්න ඔක්කොම Groups වල විස්තර ගැනීම
                const groups = await sock.groupFetchAllParticipating();
                let targetGroupJid = null;

                for (let jid in groups) {
                    if (groups[jid].subject.toLowerCase() === groupName) {
                        targetGroupJid = jid;
                        break;
                    }
                }

                if (!targetGroupJid) {
                    return await sock.sendMessage(msg.key.remoteJid, { text: '❌ ඒ නමින් Group එකක් හොයාගන්න බැරි වුණා. බොට් ඒ ගෲප් එකේ ඉන්නවද බලන්න.' });
                }

                await sock.sendMessage(msg.key.remoteJid, { text: `✅ Group එක හොයාගත්තා. ෆයිල්ස් යවමින් පවතී...` });

                for (let url of urls) {
                    await sock.sendMessage(targetGroupJid, { 
                        document: { url: url }, 
                        mimetype: 'application/octet-stream', 
                        fileName: 'group_downloaded_file' 
                    });
                }
            } catch (error) {
                console.error(error);
                await sock.sendMessage(msg.key.remoteJid, { text: '❌ Group එකට යවනකොට දෝෂයක් ආවා.' });
            }
        }

        // 3. .speed Command එක
        else if (text.trim() === '.speed') {
            await sock.sendMessage(msg.key.remoteJid, { text: '🚀 Speed එක පරීක්ෂා කරමින් පවතී. තත්පර කිහිපයක් රැඳී සිටින්න...' }, { quoted: msg });
            
            const startPing = Date.now();
            try {
                // Ping එක සහ Speed එක බැලීම
                const speed = await speedTest({ acceptLicense: true, acceptGdpr: true });
                const endPing = Date.now();
                const pingTime = endPing - startPing;

                const downloadSpeed = (speed.download.bandwidth / 125000).toFixed(2); // Mbps වලට හැරවීම
                const uploadSpeed = (speed.upload.bandwidth / 125000).toFixed(2);     // Mbps වලට හැරවීම

                const speedText = `*⚡ Speed Test Results*\n\n` +
                                  `🏓 Ping: ${pingTime} ms\n` +
                                  `⬇️ Download: ${downloadSpeed} Mbps\n` +
                                  `⬆️ Upload: ${uploadSpeed} Mbps\n` +
                                  `🌍 Server: ${speed.server.name}, ${speed.server.location}`;
                
                await sock.sendMessage(msg.key.remoteJid, { text: speedText }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(msg.key.remoteJid, { text: '❌ Speed test එක මේ වෙලාවේ වැඩ කරන්නේ නැහැ. සර්වර් දෝෂයක්.' }, { quoted: msg });
            }
        }

        // 4. .menu Command එක
        else if (text.trim() === '.menu') {
            const menuText = `*🤖 WhatsApp Downloader Bot Menu*\n\n` +
                             `*1. .si [links]*\n` +
                             `> ලින්ක්ස් වලින් ෆයිල් ඩවුන්ලෝඩ් කරලා ඔයාගේ Inbox එකටම එවයි.\n\n` +
                             `*2. .sg [group name] [links]*\n` +
                             `> අදාළ ලින්ක්ස් වලින් ෆයිල් ඩවුන්ලෝඩ් කරලා ඔයා කියන Group එකට යවයි. (Spaces තිබුණට කමක් නෑ)\n\n` +
                             `*3. .speed*\n` +
                             `> බොට් ඉන්න Server එකේ Ping එක, Download/Upload වේගය පෙන්නයි.\n\n` +
                             `*4. .menu*\n` +
                             `> මේ මෙනු එක පෙන්නයි.`;
                             
            await sock.sendMessage(msg.key.remoteJid, { text: menuText }, { quoted: msg });
        }
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('WhatsApp Bot is successfully connected!');
        }
    });
}

startBot();
