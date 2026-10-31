import { Suspense } from "react";
import App from "@/components/App";

export default function Home() {
  return (
    <Suspense fallback={<div className="cs-wrap cs-loading">Loading ChainSentinel…</div>}>
      <App />
    </Suspense>
  );
}
