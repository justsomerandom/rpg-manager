import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  createLoreBook,
  createLoreEntry,
  listLoreBooks,
  listLoreEntries,
  type LoreBook,
  type LoreEntry,
} from "../../api/lore";

export function WorldLorePage() {
  const { worldId } = useParams();
  const [books, setBooks] = useState<LoreBook[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [entries, setEntries] = useState<LoreEntry[]>([]);

  const [loadingBooks, setLoadingBooks] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [creatingBook, setCreatingBook] = useState(false);
  const [creatingEntry, setCreatingEntry] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newBookTitle, setNewBookTitle] = useState("");
  const [newBookSummary, setNewBookSummary] = useState("");
  const [entryTitle, setEntryTitle] = useState("");
  const [entryContent, setEntryContent] = useState("");

  useEffect(() => {
    if (!worldId) return;
    setLoadingBooks(true);
    listLoreBooks(worldId)
      .then((data) => {
        setBooks(data);
        if (data.length > 0) {
          setSelectedBookId((prev) => prev ?? data[0].id);
        }
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingBooks(false));
  }, [worldId]);

  useEffect(() => {
    if (!selectedBookId) {
      setEntries([]);
      return;
    }
    setLoadingEntries(true);
    listLoreEntries(selectedBookId)
      .then((data) => {
        setEntries(data);
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingEntries(false));
  }, [selectedBookId]);

  const handleCreateBook = async () => {
    if (!worldId) return;
    const title = newBookTitle.trim();
    if (!title) return;
    setCreatingBook(true);
    try {
      const book = await createLoreBook(worldId, title, newBookSummary.trim());
      setBooks((prev) => [book, ...prev]);
      setSelectedBookId(book.id);
      setNewBookTitle("");
      setNewBookSummary("");
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreatingBook(false);
    }
  };

  const handleCreateEntry = async () => {
    if (!selectedBookId) return;
    const title = entryTitle.trim();
    const content = entryContent.trim();
    if (!title || !content) return;
    setCreatingEntry(true);
    try {
      const entry = await createLoreEntry(selectedBookId, title, content);
      setEntries((prev) => [...prev, entry]);
      setEntryTitle("");
      setEntryContent("");
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreatingEntry(false);
    }
  };

  if (!worldId) {
    return <p className="text-sm text-red-400">World not found.</p>;
  }

  return (
    <div className="page-shell">
      <header className="page-header"><div><p className="section-label">Setting archive</p><h2 className="page-title mt-1">Lore library</h2><p className="page-description mt-2">
          Organize setting lore into curated books, then add chapters of text entries.
        </p></div></header>

      {error && <p className="status-error">{error}</p>}

      <section className="grid md:grid-cols-3 gap-4">
        <div className="section-card space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">
              Lore books
            </h3>
            <p className="text-xs text-slate-500">
              Collections of related lore entries.
            </p>
          </div>
          {loadingBooks ? (
            <p className="text-xs text-slate-500">Loading books...</p>
          ) : books.length === 0 ? (
            <p className="text-xs text-slate-500">
              No books yet. Create one below.
            </p>
          ) : (
            <ul className="space-y-2">
              {books.map((book) => (
                <li key={book.id}>
                  <button
                    onClick={() => setSelectedBookId(book.id)}
                    className={`w-full text-left rounded border px-3 py-2 text-sm ${
                      selectedBookId === book.id
                        ? "border-sky-500 bg-sky-950/40"
                        : "border-slate-800 hover:border-slate-600"
                    }`}
                  >
                    <p className="font-semibold text-slate-100">{book.title}</p>
                    <p className="text-xs text-slate-500">{book.summary}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-2">
            <input
              className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              placeholder="Book title"
              value={newBookTitle}
              onChange={(e) => setNewBookTitle(e.target.value)}
            />
            <textarea
              rows={2}
              className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              placeholder="Short summary"
              value={newBookSummary}
              onChange={(e) => setNewBookSummary(e.target.value)}
            />
            <button
              onClick={handleCreateBook}
              disabled={creatingBook || !newBookTitle.trim()}
              className="w-full px-3 py-2 rounded bg-sky-600 text-xs disabled:opacity-50"
            >
              {creatingBook ? "Creating..." : "Create book"}
            </button>
          </div>
        </div>

        <div className="md:col-span-2 section-card space-y-5">
          {selectedBookId ? (
            <>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-200">
                  Entries
                </h3>
                <p className="text-xs text-slate-500">
                  {loadingEntries
                    ? "Loading entries..."
                    : `${entries.length} entries in this lore book.`}
                </p>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                {entries.length === 0 && !loadingEntries ? (
                  <p className="text-xs text-slate-500">
                    No entries yet. Add your first chapter below.
                  </p>
                ) : (
                  entries.map((entry) => (
                    <article
                      key={entry.id}
                      className="rounded border border-slate-800 p-3 space-y-1"
                    >
                      <header className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-slate-100">
                          {entry.title}
                        </p>
                        <span className="text-[10px] text-slate-500">
                          {new Date(entry.created_at * 1000).toLocaleDateString()}
                        </span>
                      </header>
                      <p className="text-xs text-slate-300 whitespace-pre-wrap">
                        {entry.content}
                      </p>
                    </article>
                  ))
                )}
              </div>
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase text-slate-400">
                  Add entry
                </h4>
                <input
                  className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                  placeholder="Entry title"
                  value={entryTitle}
                  onChange={(e) => setEntryTitle(e.target.value)}
                />
                <textarea
                  rows={5}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                  placeholder="Write lore text here..."
                  value={entryContent}
                  onChange={(e) => setEntryContent(e.target.value)}
                />
                <button
                  onClick={handleCreateEntry}
                  disabled={
                    creatingEntry ||
                    !entryTitle.trim() ||
                    !entryContent.trim()
                  }
                  className="px-4 py-2 rounded bg-emerald-600 text-sm disabled:opacity-50"
                >
                  {creatingEntry ? "Adding..." : "Add entry"}
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">
              Select or create a lore book to view entries.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
