// save this as clean.js and run: node clean.js
const fs = require('fs');

// Paste the full raw code from your Knowledge Base into a file named 'raw.txt'
let code = fs.readFileSync('raw.txt', 'utf8');

// Fix string literals with trailing spaces (e.g., "sun " -> "sun")
code = code.replace(/"([a-z]+) "/g, '"$1"');
code = code.replace(/"([A-Z]+) "/g, '"$1"');

// Fix arrow functions and operators
code = code.replace(/= >/g, '=>');
code = code.replace(/& &/g, '&&');
code = code.replace(/ < /g, ' < ');
code = code.replace(/ > /g, ' > ');

// Fix specific broken syntax artifacts
code = code.replace(/typeof document ===  "undefined "/g, 'typeof document === "undefined"');
code = code.replace(/source !==  "google "/g, 'source !== "google"');
code = code.replace(/choiceId ===  "default "/g, 'choiceId === "default"');
code = code.replace(/snap\.mode ===  "light "/g, 'snap.mode === "light"');
code = code.replace(/types = \[ "card "\]/g, 'types = ["card"]');
code = code.replace(/types=\{\["map"\]\}/g, 'types={["map"]}');
code = code.replace(/v\.font === "serif"/g, 'v.font === "serif"');

// Write the cleaned code to src/app.tsx
fs.writeFileSync('src/app.tsx', code, 'utf8');
console.log('✅ Successfully generated clean src/app.tsx!');