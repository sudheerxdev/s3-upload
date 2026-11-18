import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  ClipboardList,
  CloudUpload,
  FileText,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  Plus,
  Search,
  Sparkles,
  X
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

function formatDate(value) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

export default function App() {
  const [todos, setTodos] = useState([]);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/todos`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load tasks.");
        return response.json();
      })
      .then(setTodos)
      .catch((requestError) => setError(requestError.message))
      .finally(() => setIsLoading(false));
  }, []);

  const filteredTodos = useMemo(
    () =>
      todos.filter((todo) =>
        todo.title.toLowerCase().includes(query.toLowerCase())
      ),
    [todos, query]
  );

  async function handleSubmit(event) {
    event.preventDefault();
    if (!title.trim()) {
      setError("Enter a task title before saving.");
      return;
    }

    setError("");
    setIsSubmitting(true);
    const formData = new FormData();
    formData.append("title", title.trim());
    if (file) formData.append("file", file);

    try {
      const response = await fetch(`${API_URL}/todos`, {
        method: "POST",
        body: formData
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Unable to save task.");
      setTodos((current) => [body, ...current]);
      setTitle("");
      setFile(null);
      event.target.reset();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 lg:hidden">
        <div className="flex items-center gap-2 font-bold text-ink">
          <div className="rounded-xl bg-ink p-2 text-white"><Sparkles size={17} /></div>
          Taskflow
        </div>
        <button onClick={() => setMobileNavOpen(!mobileNavOpen)} aria-label="Toggle menu">
          {mobileNavOpen ? <X /> : <Menu />}
        </button>
      </header>

      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className={`${mobileNavOpen ? "block" : "hidden"} absolute z-10 w-64 border-r border-slate-200 bg-white p-6 lg:static lg:block lg:min-h-screen`}>
          <div className="mb-12 hidden items-center gap-2 font-bold text-ink lg:flex">
            <div className="rounded-xl bg-ink p-2 text-white"><Sparkles size={17} /></div>
            Taskflow
          </div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Workspace</p>
          <nav className="space-y-1">
            <a className="flex items-center gap-3 rounded-xl bg-lavender px-3 py-3 text-sm font-semibold text-indigo-700" href="#dashboard">
              <LayoutDashboard size={18} /> Dashboard
            </a>
            <a className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-slate-500 hover:bg-slate-50" href="#tasks">
              <ClipboardList size={18} /> All tasks
            </a>
          </nav>
          <div className="mt-auto pt-16">
            <div className="rounded-2xl bg-ink p-5 text-white">
              <p className="mb-2 text-sm font-semibold">Stay on track</p>
              <p className="text-xs leading-5 text-slate-300">Add files to your tasks so everything stays in one place.</p>
            </div>
          </div>
        </aside>

        <main className="w-full px-5 py-8 sm:px-8 lg:px-12 lg:py-12" id="dashboard">
          <div className="mb-10 flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <p className="mb-2 text-sm font-medium text-indigo-600">Good morning, there</p>
              <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">Your daily overview</h1>
              <p className="mt-2 text-sm text-slate-500">A simple space for your most important work.</p>
            </div>
            <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-3 text-slate-400" size={18} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks..." className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm outline-none ring-indigo-100 focus:ring-4" />
            </div>
          </div>

          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            <StatCard label="Total tasks" value={todos.length} icon={<ClipboardList size={19} />} />
            <StatCard label="With attachments" value={todos.filter((todo) => todo.file_url).length} icon={<FileText size={19} />} />
            <StatCard label="This week" value={todos.filter((todo) => Date.now() - new Date(todo.created_at) < 604800000).length} icon={<CheckCircle2 size={19} />} />
          </div>

          <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7" id="tasks">
              <div className="mb-6 flex items-center justify-between">
                <div><h2 className="text-lg font-bold text-ink">Recent tasks</h2><p className="mt-1 text-sm text-slate-500">Your latest additions</p></div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">{filteredTodos.length} tasks</span>
              </div>
              {isLoading ? <div className="flex justify-center py-16 text-indigo-600"><LoaderCircle className="animate-spin" /></div> : filteredTodos.length === 0 ? <div className="py-16 text-center text-sm text-slate-400">No tasks found. Add your first one.</div> : <div className="space-y-3">{filteredTodos.map((todo) => <article key={todo.id} className="flex items-center justify-between gap-4 rounded-xl border border-slate-100 p-4 transition hover:border-indigo-100 hover:bg-indigo-50/30"><div className="flex min-w-0 items-center gap-3"><div className="rounded-lg bg-emerald-50 p-2 text-emerald-600"><CheckCircle2 size={18} /></div><div className="min-w-0"><h3 className="truncate text-sm font-semibold text-ink">{todo.title}</h3><p className="mt-1 text-xs text-slate-400">{formatDate(todo.created_at)}</p></div></div>{todo.file_url && <span className="shrink-0 rounded-lg bg-indigo-50 p-2 text-indigo-600" title="Attachment uploaded"><FileText size={16} /></span>}</article>)}</div>}
            </section>

            <section className="rounded-2xl bg-indigo-600 p-6 text-white shadow-lg shadow-indigo-100">
              <div className="mb-7 flex items-center justify-between"><div><h2 className="text-lg font-bold">Add a new task</h2><p className="mt-1 text-sm text-indigo-200">Capture it while it&apos;s fresh.</p></div><div className="rounded-xl bg-white/15 p-2"><Plus size={20} /></div></div>
              <form onSubmit={handleSubmit} className="space-y-5">
                <label className="block text-sm font-medium">Task title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What needs to be done?" className="mt-2 w-full rounded-xl border-0 bg-white/10 px-4 py-3 text-sm text-white outline-none placeholder:text-indigo-200 focus:ring-2 focus:ring-white/60" /></label>
                <label className="block text-sm font-medium">Attachment<span className="mt-2 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-indigo-300 bg-indigo-500/40 px-4 py-3 text-sm text-indigo-100 hover:bg-indigo-500"><CloudUpload size={19} />{file ? <span className="truncate">{file.name}</span> : "Upload a file"}<input type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} className="hidden" /></span></label>
                {error && <p className="rounded-lg bg-red-400/20 px-3 py-2 text-xs text-red-100">{error}</p>}
                <button disabled={isSubmitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-70">{isSubmitting ? <LoaderCircle className="animate-spin" size={17} /> : <ArrowUpRight size={17} />} {isSubmitting ? "Saving..." : "Create task"}</button>
              </form>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-5 flex items-center justify-between"><span className="text-sm text-slate-500">{label}</span><span className="rounded-lg bg-slate-100 p-2 text-slate-600">{icon}</span></div><p className="text-3xl font-bold text-ink">{value}</p></div>;
}
