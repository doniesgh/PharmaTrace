"use client";
import dynamic from "next/dynamic";

// MetaMask (window.ethereum) only exists in the browser: no server rendering.
const PharmaApp = dynamic(() => import("./PharmaApp"), { ssr: false });

export default function Home() {
  return <PharmaApp />;
}
