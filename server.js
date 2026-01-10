//import { inject } from "@vercel/analytics"
const { inject } = require("@vercel/analytics");
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const path = require('path');
const https = require('https'); 

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ================= HELPER FUNCTIONS =================

function extractName(html) {
    try {
        const nameMatch = html.match(/\d+\s*-\s+(.+?)\s*\|\|/);
        if (nameMatch && nameMatch[1]) {
            return nameMatch[1].replace(/&#160;/g, ' ').trim();
        }
    } catch (e) { }
    return "Unknown Name";
}

function extractGrade(html) {
    try {
        const match = html.match(/<strong>Mean Grade:<\/strong>[\s\S]*?<span[^>]*>([^<]+)<\/span>/i);
        if (match && match[1]) return match[1].trim();
    } catch (e) { }
    const fallback = html.match(/Grade:\s*([A-Za-z0-9\-\+]+)/);
    return fallback ? fallback[1] : "Unknown Grade";
}

// ================= STREAMING ENDPOINT =================

app.post('/api/check-results', async (req, res) => {
    // 1. Set headers for Streaming (Server-Sent Events)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { name, baseIndex, start, end } = req.body;
    const baseUrl = "https://results.knec.ac.ke";
    const resultsEndpoint = "/Home/CheckResults";
    
    const totalItems = parseInt(end) - parseInt(start) + 1;
    let processedCount = 0;

    // Flush headers immediately
    res.flushHeaders();

    console.log(`Starting scan for ${name}...`);

    for (let i = parseInt(start); i <= parseInt(end); i++) {
        const suffix = i.toString().padStart(3, '0');
        const indexNumber = `${baseIndex}${suffix}`;
        
        processedCount++;
        const remaining = totalItems - processedCount;

        try {
            const response = await axios.post(`${baseUrl}${resultsEndpoint}`, 
                new URLSearchParams({
                    indexNumber: indexNumber,
                    name: name,
                    consent: "true"
                }), 
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                        'Referer': baseUrl
                    },
                    httpsAgent: new https.Agent({ rejectUnauthorized: false })
                }
            );

            const html = response.data;
            
            // Check for match
            const isInvalid = html.includes("Please enter a valid index number");
            const hasTableWrapper = html.includes("results-table-wrapper");

            if (!isInvalid && hasTableWrapper) {
                const realName = extractName(html);
                const grade = extractGrade(html);

                console.log(`[MATCH] ${indexNumber}`);

                // 2. Send "RESULT" event to browser immediately
                const resultData = {
                    type: 'result',
                    index: indexNumber,
                    realName: realName,
                    grade: grade
                };
                res.write(`data: ${JSON.stringify(resultData)}\n\n`);
            }

        } catch (error) {
            // Silent error
        }

        // 3. Send "PROGRESS" event to browser to update counters
        const progressData = {
            type: 'progress',
            remaining: remaining,
            current: indexNumber
        };
        res.write(`data: ${JSON.stringify(progressData)}\n\n`);

        // Delay
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 4. Send "DONE" event
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
    console.log("Scan complete.");
});

const server = app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
server.timeout = 300000; 