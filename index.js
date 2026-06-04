const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const FormData = require('form-data');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const { convert } = require('html-to-text');

// --- CONFIGURATION ---
const imapConfig = {
    imap: {
        user: process.env.IMAP_USER,
        password: process.env.IMAP_PASSWORD,
        host: process.env.IMAP_HOST,
        port: parseInt(process.env.IMAP_PORT || '993', 10),
        tls: true,
        authTimeout: 3000
    }
};

const PAPRA_BASE_URL = process.env.PAPRA_BASE_URL || 'https://api.papra.app';
const PAPRA_API_TOKEN = process.env.PAPRA_API_TOKEN;
const DEFAULT_ORG_ID = process.env.PAPRA_DEFAULT_ORG_ID;
const TRASH_AFTER_IMPORT = process.env.TRASH_AFTER_IMPORT === 'true';
const TRASH_FOLDER = process.env.TRASH_FOLDER || 'Trash';

// --- EMAIL TO ORG MAP ---
const EMAIL_TO_ORG_MAP = JSON.parse(process.env.EMAIL_TO_ORG_MAP || '{}');

// --- HELPER FUNCTIONS ---

function resolveOrganizationId(toAddressHeader) {
    if (!toAddressHeader) return DEFAULT_ORG_ID;

    let recipientEmail = '';
    if (toAddressHeader.value && toAddressHeader.value.length > 0) {
        recipientEmail = toAddressHeader.value[0].address.toLowerCase().trim();
    } else if (typeof toAddressHeader === 'string') {
        const match = toAddressHeader.match(/<([^>]+)>/);
        recipientEmail = (match ? match[1] : toAddressHeader).toLowerCase().trim();
    }

    console.log(`Incoming message sent to: ${recipientEmail}`);

    if (EMAIL_TO_ORG_MAP[recipientEmail]) {
        return EMAIL_TO_ORG_MAP[recipientEmail];
    }

    console.log(`⚠️ No specific mapping found for ${recipientEmail}. Using default Org ID.`);
    return DEFAULT_ORG_ID;
}

function generateEmailPdf(parsedEmail) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50 });
        const buffers = [];

        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
            const pdfBuffer = Buffer.concat(buffers);
            resolve(pdfBuffer);
        });
        doc.on('error', (err) => reject(err));

        // --- PDF Content Layout ---
        doc.font('Helvetica-Bold').fontSize(16).text(parsedEmail.subject || '(No Subject)', { underline: true });
        doc.moveDown(1);

        doc.font('Helvetica').fontSize(10)
           .text(`From: ${parsedEmail.from?.text || 'Unknown'}`)
           .text(`Date: ${parsedEmail.date ? parsedEmail.date.toString() : 'Unknown'}`)
           .text(`To: ${parsedEmail.to?.text || 'Unknown'}`);

        doc.moveDown(1.5);
        doc.moveTo(50, doc.y).lineTo(562, doc.y).strokeColor('#cccccc').stroke();
        doc.moveDown(1.5);

        let bodyText = parsedEmail.text;
        if (!bodyText && parsedEmail.html) {
            bodyText = convert(parsedEmail.html, { wordwrap: false });
        }
        bodyText = bodyText || 'This email has no text content.';
        doc.font('Helvetica').fontSize(11).text(bodyText, {
            lineGap: 4
        });

        doc.end();
    });
}

async function uploadToPapra(fileBuffer, fileName, orgId) {
    try {
        const form = new FormData();
        form.append('file', fileBuffer, { filename: fileName });
        form.append('ocrLanguages', 'eng');

        console.log(`Uploading ${fileName} to Org: ${orgId}...`);

        const response = await axios.post(
            `${PAPRA_BASE_URL}/api/organizations/${orgId}/documents`,
            form,
            {
                headers: {
                    ...form.getHeaders(),
                    'Authorization': `Bearer ${PAPRA_API_TOKEN}`
                }
            }
        );

        const documentId = response.data.document.id;
        console.log(`✅ Successfully uploaded ${fileName} (ID: ${documentId})`);
        return true;

    } catch (error) {
        console.error(`❌ Failed uploading ${fileName}:`, error.response ? error.response.data : error.message);
        return false;
    }
}

function sanitizeFilename(subject) {
    if (!subject) return 'untitled_email';
    return subject.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 50);
}

// --- MAIN EXECUTION ---
async function processEmails() {
    try {
        const connection = await imaps.connect(imapConfig);
        await connection.openBox('INBOX');

        const searchCriteria = ['UNSEEN'];
        const fetchOptions = { bodies: ['HEADER', 'TEXT', ''], markSeen: true };

        const messages = await connection.search(searchCriteria, fetchOptions);
        console.log(`Found ${messages.length} unread emails.`);

        for (const item of messages) {
            const all = item.parts.find(part => part.which === '');
            const parsedEmail = await simpleParser(all.body);

            console.log(`\nProcessing Email: "${parsedEmail.subject}"`);

            const targetOrgId = resolveOrganizationId(parsedEmail.to);
            console.log(`Target Destination -> Org: ${targetOrgId}`);

            // --- NEW: Check for the attachments-only skip flag ---
            const emailBodyText = parsedEmail.text || '';
            const skipEmailBody = emailBodyText.includes('{{papra_attachments_only}}');

            let allSucceeded = true;

            // 1. Convert the email body into a PDF (unless flagged to skip)
            if (!skipEmailBody) {
                const safeSubject = sanitizeFilename(parsedEmail.subject);
                const emailFilename = `email_${safeSubject}.pdf`;

                try {
                    console.log(`Generating PDF for email body...`);
                    const pdfBuffer = await generateEmailPdf(parsedEmail);
                    const ok = await uploadToPapra(pdfBuffer, emailFilename, targetOrgId);
                    if (!ok) allSucceeded = false;
                } catch (pdfErr) {
                    console.error(`❌ Failed to compile PDF for email body:`, pdfErr.message);
                    allSucceeded = false;
                }
            } else {
                console.log(`ℹ️ Skip flag found. Skipping email body PDF compilation.`);
            }

            // 2. Process external attachments
            if (parsedEmail.attachments && parsedEmail.attachments.length > 0) {
                for (const attachment of parsedEmail.attachments) {
                    if (attachment.related) continue; // Skip inline media asset duplicates

                    const ok = await uploadToPapra(
                        attachment.content,
                        attachment.filename,
                        targetOrgId
                    );
                    if (!ok) allSucceeded = false;
                }
            } else {
                console.log('No extra attachments found in this email.');
            }

            if (TRASH_AFTER_IMPORT && allSucceeded) {
                await connection.moveMessage(item.attributes.uid, TRASH_FOLDER);
                console.log(`🗑️ Email moved to ${TRASH_FOLDER}.`);
            }
        }

        connection.end();
    } catch (err) {
        console.error('IMAP Error:', err);
    }
}

processEmails();
