import AuctionBoard from "@/components/auction/AuctionBoard";

export const dynamic = "force-dynamic";

export default function AuctionPage() {
  return (
    <main className="mx-auto max-w-[1600px] px-4 py-4">
      <AuctionBoard />
    </main>
  );
}
