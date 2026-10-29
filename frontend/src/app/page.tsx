import { Suspense } from "react";
import App from "@/components/App";

export default function Home() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500">Loading ChainSentinel…</div>}>
      <App />
    </Suspense>
  );
}
