import "@fontsource/poppins/300.css";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "./globals.css";
import RegisterSW from "./RegisterSW";

export const metadata = {
  title: "PharmaTrace",
  description: "Traçabilité des médicaments sur blockchain",
  icons: { icon: "/icon.svg" },
};
export const viewport = { themeColor: "#0B5C60" };

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>
        <RegisterSW />
        {children}
      </body>
    </html>
  );
}
