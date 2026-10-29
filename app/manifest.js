export default function manifest() {
  return {
    name: "PharmaTrace",
    short_name: "PharmaTrace",
    description: "Traçabilité des médicaments sur blockchain",
    lang: "fr",
    start_url: "/",
    display: "standalone",
    theme_color: "#0B5C60",
    background_color: "#0B5C60",
    icons: [
      { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
      { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
      { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
