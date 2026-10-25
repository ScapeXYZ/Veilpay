"use client";

import { ArrowLeft, RefreshCw } from "lucide-react";
import Link from "next/link";
import { use } from "react";
import { PaymentDetail } from "@/components/payment";
import { PageHeader, RequireContext } from "@/components/shell";
import { MainnetReadOnlyNotice } from "@/components/mainnet-readonly";
import { Button, Card, ErrorBox, Skeleton } from "@/components/ui";
import { useNetworkMode } from "@/lib/api/data-source";
import { errorText, usePayment } from "@/lib/api/hooks";

function Detail({ id }: { id: string }) {
  const { data, isLoading, error, refetch, isFetching } = usePayment(id);
  if (error) return <ErrorBox>{errorText(error)}</ErrorBox>;
  if (isLoading || !data) return <Skeleton className="h-80" />;
  return (
    <Card testId="payment-page">
      <div className="mb-4 flex justify-end">
        <Button variant="secondary" onClick={() => refetch()} busy={isFetching} data-testid="refresh-evidence">
          <RefreshCw size={14} aria-hidden /> Refresh status
        </Button>
      </div>
      <PaymentDetail p={data} />
      <p className="mt-4 text-xs text-zinc-500">Refresh checks the latest status. It never sends again.</p>
    </Card>
  );
}

export default function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const mode = useNetworkMode();
  if (mode.kind === "mainnet_readonly" || mode.kind === "unknown") {
    return (
      <>
        <PageHeader
          title={mode.kind === "unknown" ? "Payment details unavailable" : "Payment details unavailable on mainnet"}
          subtitle={mode.kind === "unknown" ? "Server status is unavailable, so VeilPay cannot retrieve agent payment data." : "Mainnet observation is wallet-only. VeilPay does not retrieve or create agent payment records here."}
        />
        <MainnetReadOnlyNotice area="Payment details" unknown={mode.kind === "unknown"} />
      </>
    );
  }
  const { id } = use(params);
  return (
    <>
      <Link href="/app/payments" className="inline-flex items-center gap-1 self-start text-sm text-zinc-400 hover:text-zinc-100">
        <ArrowLeft size={14} aria-hidden /> Payments
      </Link>
      <PageHeader title="Payment" subtitle="Everything that happened to this payment, in order. It shows paid only once the VeilPay server reports enough network confirmations; in practice mode they are simulated." />
      <RequireContext ctx="customer">
        <Detail id={id} />
      </RequireContext>
    </>
  );
}
