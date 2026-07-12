import PlanEditorLoader from "@/components/venue/PlanEditorLoader";

export default function VenuePage() {
  return (
    <main className="flex flex-1 flex-col items-center gap-8 bg-zinc-50 px-4 py-16">
      <div className="w-full max-w-5xl">
        <h1 className="text-2xl font-semibold tracking-tight text-black">
          場地規劃
        </h1>
        <div className="mt-6">
          <PlanEditorLoader />
        </div>
      </div>
    </main>
  );
}
