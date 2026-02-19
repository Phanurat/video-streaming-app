const express = require('express');
const app = express();
const PORT = 9000;

app.get('/', (req, res) => {
  res.send(`
    <html>
      <body style="background-color: #1a1a1a; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0;">
        <h1 style="margin-bottom: 20px;">Custom Style Player</h1>
        
        <div style="border: 5px solid #333; border-radius: 15px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          <iframe 
            width="700" 
            height="394" 
            src="https://www.youtube.com/embed/1_5nEtt5b60?modestbranding=1&rel=0&iv_load_policy=3&controls=2" 
            frameborder="0" 
            allowfullscreen>
          </iframe>
        </div>

        <p style="color: #888; margin-top: 15px;">* ปรับแต่งกรอบและเงาด้วย CSS รอบตัว Iframe</p>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});