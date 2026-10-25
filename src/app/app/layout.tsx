import type { ReactNode } from "react";
import { AppShell } from "@/components/shell";
import { PracticeFrame } from "@/components/sealed/practice-frame";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <PracticeFrame>{children}</PracticeFrame>
    </AppShell>
  );
}
