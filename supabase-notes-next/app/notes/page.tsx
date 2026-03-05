import { createClient } from "@/utils/supabase/server";
import { Suspense } from "react";

function NotesFallback() {
  return (
    <pre className="overflow-auto rounded-md border border-slate-300 bg-slate-50 p-4 text-sm text-slate-900">
      Loading notes...
    </pre>
  );
}

async function NotesData() {
  const supabase = await createClient();
  const { data: notes, error } = await supabase
    .from("notes")
    .select("*")
    .order("id", { ascending: true });

  if (error) {
    return (
      <pre className="overflow-auto rounded-md border border-red-400/40 bg-red-50 p-4 text-sm text-red-800">
        {`Supabase query error: ${error.message}`}
      </pre>
    );
  }

  return (
    <pre className="overflow-auto rounded-md border border-slate-300 bg-slate-50 p-4 text-sm text-slate-900">
      {JSON.stringify(notes ?? [], null, 2)}
    </pre>
  );
}

export default function NotesPage() {
  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-4 text-2xl font-semibold">Notes</h1>
      <Suspense fallback={<NotesFallback />}>
        <NotesData />
      </Suspense>
    </main>
  );
}
