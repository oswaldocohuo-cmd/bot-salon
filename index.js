const express = require('express');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleSpreadsheet } = require('google-spreadsheet');

const app = express();
app.use(express.json());

// Inicializar Claude con tu API Key de Railway
const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

// REGLAS DEL NEGOCIO REALES DE MANUEL SALÓN (CORREGIDO)
const SYSTEM_PROMPT = `Eres Manuel, el asistente virtual inteligente de la peluquería "Manuel Salón". Tu objetivo es agendar, cambiar o cancelar citas de forma amable y eficiente a través de WhatsApp.

Menu oficial de servicios y precios:
1. Corte de Caballero: $280 MXN
2. Corte de Niño: $280 MXN
3. Corte de Niña: $350 MXN
4. Corte de Dama: $400 MXN
5. Tinte (Color Global): Desde $1200 MXN (Indica al cliente que varía según el largo del cabello)
6. Mechas y Balayage (Técnicas de Iluminación): Desde $1500 MXN (Indica al cliente que varía según el largo)
7. Tratamiento de Ácido Hialurónico + Olaplex + Estilizado: $750 MXN (Precio Promoción)
8. Tratamiento de Ácido Hialurónico + Olaplex + Corte de Dama: $999 MXN
9. Corte de Caballero + Barba Delineada: $480 MXN
10. Secado de Cabello (Blower): Desde $300 MXN
11. Alaciado Express con Ácido Hialurónico: $350 MXN

Tus reglas de comportamiento son estrictas:
1. Saluda cordialmente, ofrece los servicios y precios exactos si el cliente te pregunta.
2. Pide siempre el nombre del cliente de forma amable si no lo conoces.
3. Para los servicios de Tinte o Mechas/Balayage, aclara siempre que el precio base es "Desde..." y puede variar según el largo de su cabello.
4. Para agendar o consultar horarios, ofrece los días disponibles basados en el sistema. No inventes horas.
5. NUNCA empalmes o encimes una cita si el sistema te dice que está ocupado.
6. Mantén tus respuestas breves, amables, profesionales y con buena ortografía, ideales para leer en WhatsApp.`;

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    if (body.object === 'whatsapp_business_account' && body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
      const messageData = body.entry[0].changes[0].value.messages[0];
      const customerPhone = messageData.from;
      const customerMessage = messageData.text?.body;
      const customerName = body.entry[0].changes[0].value.contacts?.[0]?.profile?.name || "Cliente";

      if (customerMessage) {
        // Graba el número automáticamente en tu Google Sheets
        await registrarEnSheets(customerPhone, customerName);
        
        // Claude procesa el mensaje con tus precios reales
        const responseText = await consultarAClaude(customerMessage, customerPhone, customerName);
        
        // Manda la respuesta a WhatsApp
        await enviarWhatsApp(customerPhone, responseText);
      }
    }
    res.sendStatus(200);
  } catch (error) {
    console.error("Error procesando mensaje:", error);
    res.sendStatus(500);
  }
});

async function registrarEnSheets(phone, name) {
  try {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEETS_ID, {
      auth: {
        clientEmail: creds.client_email,
        privateKey: creds.private_key.replace(/\\n/g, '\n'),
      }
    });
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    
    const rows = await sheet.getRows();
    const existe = rows.find(row => row.get('Telefono') === phone);
    
    if (!existe) {
      await sheet.addRow({ Nombre: name, Telefono: phone, FechaRegistro: new Date().toISOString() });
    }
  } catch (err) {
    console.error("Error al registrar en Google Sheets:", err);
  }
}

async function consultarAClaude(mensajeCliente, telefono, nombre) {
  const msg = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `El cliente llamado ${nombre} con teléfono ${telefono} dice: "${mensajeCliente}"` }],
  });
  return msg.content[0].text;
}

async function enviarWhatsApp(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.META_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "text",
        text: { body: text }
      },
      {
        headers: { Authorization: `Bearer ${process.env.META_WA_TOKEN}` }
      }
    );
  } catch (error) {
    console.error("Error enviando WhatsApp:", error.response?.data || error.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot de Manuel Salón corriendo en puerto ${PORT}`));