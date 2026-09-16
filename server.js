import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

dotenv.config();

const fastify = Fastify({ logger: true });
await fastify.register(cors, { origin: '*' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

fastify.get('/health', async () => {
  const memoryMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  return { status: 'ok', memoryUsage: `${memoryMB} MB` };
});

fastify.post('/api/process-ledger', async (request, reply) => {
  try {
    const { imageBase64, mimeType = 'image/jpeg', recipientEmail } = request.body;

    if (!imageBase64) {
      return reply.status(400).send({ error: 'imageBase64 field is required' });
    }

    // 1. Vision OCR & Extraction via Gemini 1.5 Flash
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const visionPrompt = `Analyze this daily ledger image. Extract all sales data into JSON format with the following keys:
    - "date": "YYYY-MM-DD" or current date
    - "items": array of objects with [{"name": string, "quantity": number, "price": number}]
    - "total_sales": number
    - "executive_summary": A warm, simple, 3-sentence non-accountant financial summary highlighting top sellers and performance observations. Return ONLY valid JSON without markdown formatting code blocks.`;

    const imagePart = {
      inlineData: {
        data: imageBase64,
        mimeType,
      },
    };

    const result = await model.generateContent([visionPrompt, imagePart]);
    const responseText = result.response.text().replace(/```json|```/g, '').trim();
    const parsedData = JSON.parse(responseText);

    // 2. Save into Supabase
    const { error: dbError } = await supabase.from('ledger_entries').insert([
      {
        date: parsedData.date || new Date().toISOString().split('T')[0],
        items_json: parsedData.items,
        total_sales: parsedData.total_sales,
        summary_text: parsedData.executive_summary,
      },
    ]);

    if (dbError) fastify.log.error(dbError);

    // 3. Dispatch Email Summary
    const targetEmail = recipientEmail || process.env.GMAIL_USER;
    await transporter.sendMail({
      from: `"LedgerLens AI" <${process.env.GMAIL_USER}>`,
      to: targetEmail,
      subject: `Daily Financial Briefing - ${parsedData.date || 'Esthy\'s Kitchen'}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
          <h2>Daily Sales Executive Summary</h2>
          <p><strong>Total Revenue:</strong> $${parsedData.total_sales}</p>
          <div style="background: #f4f4f5; padding: 15px; border-radius: 8px; margin: 15px 0;">
            <p><strong>Key Insights:</strong></p>
            <p>${parsedData.executive_summary}</p>
          </div>
          <h3>Itemized Breakdown</h3>
          <ul>
            ${(parsedData.items || []).map(i => `<li>${i.name} (x${i.quantity}) - $${i.price}</li>`).join('')}
          </ul>
        </div>
      `,
    });

    return { status: 'success', data: parsedData };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to process ledger image', details: err.message });
  }
});

const start = async () => {
  try {
    const port = process.env.PORT || 10000;
    await fastify.listen({ port: Number(port), host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();