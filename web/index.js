import { createApp } from "./lib/server.js";

const PORT = process.env.PORT || 3000;
const app = createApp();

app.listen(PORT, () => {
  console.log(`E-Ink Reader web app running at http://localhost:${PORT}`);
});
