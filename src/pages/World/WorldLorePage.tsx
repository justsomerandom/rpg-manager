import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useBlocker, useParams } from "react-router-dom";
import { getErrorMessage } from "../../api/client";
import {
  createLoreBook,
  createLoreEntry,
  deleteLoreBook,
  deleteLoreEntry,
  listLoreBooks,
  listLoreEntries,
  updateLoreBook,
  updateLoreEntry,
  type LoreBook,
  type LoreEntry,
} from "../../api/lore";

export function WorldLorePage() {
  const { worldId } = useParams();
  const entryEditorRef = useRef<HTMLDivElement>(null);
  const [books, setBooks] = useState<LoreBook[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [entries, setEntries] = useState<LoreEntry[]>([]);

  const [loadingBooks, setLoadingBooks] = useState(Boolean(worldId));
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [booksLoadFailed, setBooksLoadFailed] = useState(false);
  const [entriesLoadFailed, setEntriesLoadFailed] = useState(false);
  const [booksError, setBooksError] = useState<string | null>(null);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [booksReloadKey, setBooksReloadKey] = useState(0);
  const [entriesReloadKey, setEntriesReloadKey] = useState(0);

  const [creatingBook, setCreatingBook] = useState(false);
  const [newBookTitle, setNewBookTitle] = useState("");
  const [newBookSummary, setNewBookSummary] = useState("");
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [bookTitle, setBookTitle] = useState("");
  const [bookSummary, setBookSummary] = useState("");
  const [savingBook, setSavingBook] = useState(false);
  const [deletingBook, setDeletingBook] = useState(false);

  const [entryTitle, setEntryTitle] = useState("");
  const [entryContent, setEntryContent] = useState("");
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [savingEntry, setSavingEntry] = useState(false);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);

  useEffect(() => {
    setBooks([]);
    setSelectedBookId(null);
    setEntries([]);
    setEditingBookId(null);
    setEditingEntryId(null);
    setEntryTitle("");
    setEntryContent("");
    setNewBookTitle("");
    setNewBookSummary("");
  }, [worldId]);

  useEffect(() => {

    if (!worldId) {
      setBooks([]);
      setLoadingBooks(false);
      setBooksLoadFailed(true);
      setBooksError("This page needs a valid world.");
      return;
    }

    let cancelled = false;
    setLoadingBooks(true);
    setBooksLoadFailed(false);
    setBooksError(null);
    listLoreBooks(worldId)
      .then((data) => {
        if (cancelled) return;
        setBooks(data);
        setSelectedBookId(data[0]?.id ?? null);
      })
      .catch((error) => {
        if (!cancelled) {
          setBooksLoadFailed(true);
          setBooksError(getErrorMessage(error, "We couldn't load the lore books."));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingBooks(false);
      });

    return () => {
      cancelled = true;
    };
  }, [booksReloadKey, worldId]);

  useEffect(() => {
    setEntries([]);
    setEntriesError(null);
    setEntriesLoadFailed(false);
    if (!selectedBookId) {
      setLoadingEntries(false);
      return;
    }

    let cancelled = false;
    setLoadingEntries(true);
    listLoreEntries(selectedBookId)
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch((error) => {
        if (!cancelled) {
          setEntriesLoadFailed(true);
          setEntriesError(getErrorMessage(error, "We couldn't load this book's entries."));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingEntries(false);
      });

    return () => {
      cancelled = true;
    };
  }, [entriesReloadKey, selectedBookId]);

  const selectedBook = useMemo(
    () => books.find((book) => book.id === selectedBookId) ?? null,
    [books, selectedBookId]
  );
  const editingEntry = useMemo(
    () => entries.find((entry) => entry.id === editingEntryId) ?? null,
    [editingEntryId, entries]
  );

  const newBookDirty = Boolean(newBookTitle || newBookSummary);
  const bookEditDirty = Boolean(
    selectedBook &&
      editingBookId === selectedBook.id &&
      (bookTitle !== selectedBook.title || bookSummary !== selectedBook.summary)
  );
  const entryDraftDirty = editingEntry
    ? entryTitle !== editingEntry.title || entryContent !== editingEntry.content
    : Boolean(entryTitle || entryContent);
  const hasUnsavedWork = newBookDirty || bookEditDirty || entryDraftDirty;

  const blocker = useBlocker(hasUnsavedWork && !creatingBook && !savingBook && !savingEntry);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm("Discard your unsaved lore changes and leave this page?")) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  const clearEntryEditor = () => {
    setEditingEntryId(null);
    setEntryTitle("");
    setEntryContent("");
  };

  const clearBookEditor = () => {
    setEditingBookId(null);
    setBookTitle("");
    setBookSummary("");
  };

  const confirmDiscardSelectionWork = () => {
    if (!bookEditDirty && !entryDraftDirty) return true;
    return window.confirm("Discard unsaved changes for the current lore book?");
  };

  const handleSelectBook = (bookId: string) => {
    if (bookId === selectedBookId) return;
    if (creatingBook || savingBook || deletingBook || savingEntry || deletingEntryId) return;
    if (!confirmDiscardSelectionWork()) return;
    clearBookEditor();
    clearEntryEditor();
    setSelectedBookId(bookId);
    setEntriesError(null);
    setMessage(null);
  };

  const handleCreateBook = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!worldId || creatingBook) return;
    const title = newBookTitle.trim();
    if (!title) {
      setBooksError("Book title is required.");
      return;
    }
    if (!confirmDiscardSelectionWork()) return;

    setCreatingBook(true);
    setBooksError(null);
    setMessage(null);
    try {
      const book = await createLoreBook(worldId, title, newBookSummary.trim());
      setBooks((current) => [book, ...current]);
      clearBookEditor();
      clearEntryEditor();
      setSelectedBookId(book.id);
      setNewBookTitle("");
      setNewBookSummary("");
      setMessage(`“${book.title}” was created.`);
    } catch (error) {
      setBooksError(getErrorMessage(error, "We couldn't create that lore book."));
    } finally {
      setCreatingBook(false);
    }
  };

  const startBookEdit = () => {
    if (!selectedBook) return;
    setEditingBookId(selectedBook.id);
    setBookTitle(selectedBook.title);
    setBookSummary(selectedBook.summary);
    setBooksError(null);
    setMessage(null);
  };

  const handleUpdateBook = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedBook || editingBookId !== selectedBook.id || savingBook) return;
    const title = bookTitle.trim();
    if (!title) {
      setBooksError("Book title is required.");
      return;
    }

    setSavingBook(true);
    setBooksError(null);
    setMessage(null);
    try {
      const updated = await updateLoreBook(selectedBook.id, title, bookSummary.trim());
      setBooks((current) => current.map((book) => (book.id === updated.id ? updated : book)));
      clearBookEditor();
      setMessage(`“${updated.title}” was updated.`);
    } catch (error) {
      setBooksError(getErrorMessage(error, "We couldn't update that lore book."));
    } finally {
      setSavingBook(false);
    }
  };

  const handleDeleteBook = async () => {
    if (!selectedBook || deletingBook || savingBook || savingEntry) return;
    const confirmed = window.confirm(
      `Delete “${selectedBook.title}” and all ${entries.length} entr${entries.length === 1 ? "y" : "ies"} inside it? This cannot be undone.`
    );
    if (!confirmed) return;

    const deletedId = selectedBook.id;
    setDeletingBook(true);
    setBooksError(null);
    setMessage(null);
    try {
      await deleteLoreBook(deletedId);
      const remaining = books.filter((book) => book.id !== deletedId);
      setBooks(remaining);
      setEntries([]);
      clearBookEditor();
      clearEntryEditor();
      setSelectedBookId(remaining[0]?.id ?? null);
      setMessage(`“${selectedBook.title}” was deleted.`);
    } catch (error) {
      setBooksError(getErrorMessage(error, "We couldn't delete that lore book."));
    } finally {
      setDeletingBook(false);
    }
  };

  const handleSaveEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedBookId || savingEntry) return;
    const title = entryTitle.trim();
    const content = entryContent.trim();
    if (!title || !content) {
      setEntriesError("Entry title and content are required.");
      return;
    }

    const targetBookId = selectedBookId;
    setSavingEntry(true);
    setEntriesError(null);
    setMessage(null);
    try {
      if (editingEntry) {
        const updated = await updateLoreEntry(editingEntry.id, title, content);
        if (selectedBookId === targetBookId) {
          setEntries((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
        }
        setMessage(`“${updated.title}” was updated.`);
      } else {
        const created = await createLoreEntry(targetBookId, title, content);
        if (selectedBookId === targetBookId) setEntries((current) => [...current, created]);
        setMessage(`“${created.title}” was added to ${selectedBook?.title ?? "the lore book"}.`);
      }
      clearEntryEditor();
    } catch (error) {
      setEntriesError(getErrorMessage(error, "We couldn't save that lore entry."));
    } finally {
      setSavingEntry(false);
    }
  };

  const startEntryEdit = (entry: LoreEntry) => {
    if (editingEntryId === entry.id) return;
    if (entryDraftDirty && !window.confirm("Discard the current unsaved lore entry?")) return;
    setEditingEntryId(entry.id);
    setEntryTitle(entry.title);
    setEntryContent(entry.content);
    setEntriesError(null);
    setMessage(null);
    requestAnimationFrame(() => entryEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const handleDeleteEntry = async (entry: LoreEntry) => {
    if (deletingEntryId || savingEntry) return;
    if (!window.confirm(`Delete “${entry.title}”? This cannot be undone.`)) return;
    setDeletingEntryId(entry.id);
    setEntriesError(null);
    setMessage(null);
    try {
      await deleteLoreEntry(entry.id);
      setEntries((current) => current.filter((candidate) => candidate.id !== entry.id));
      if (editingEntryId === entry.id) clearEntryEditor();
      setMessage(`“${entry.title}” was deleted.`);
    } catch (error) {
      setEntriesError(getErrorMessage(error, "We couldn't delete that lore entry."));
    } finally {
      setDeletingEntryId(null);
    }
  };

  if (!worldId) {
    return <p className="status-error" role="alert">This page needs a valid world.</p>;
  }

  return (
    <div className="page-shell max-w-7xl">
      <header className="page-header">
        <div>
          <p className="section-label">Setting archive</p>
          <h1 className="page-title mt-1">Lore library</h1>
          <p className="page-description mt-2">Organize long-form setting material into editable books and chapters.</p>
        </div>
      </header>

      <div aria-live="polite">
        {booksError && <p className="status-error" role="alert">{booksError}</p>}
        {entriesError && <p className="status-error" role="alert">{entriesError}</p>}
        {message && <p className="status-success">{message}</p>}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[20rem_1fr]">
        <aside className="section-card space-y-5 lg:sticky lg:top-4" aria-labelledby="lore-books-heading">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 id="lore-books-heading" className="text-sm font-semibold text-slate-200">Lore books</h2>
              {!loadingBooks && <p className="mt-1 text-xs text-slate-500">{books.length} collection{books.length === 1 ? "" : "s"}</p>}
            </div>
            {booksLoadFailed && <button type="button" className="secondary-button text-xs" onClick={() => setBooksReloadKey((key) => key + 1)}>Retry</button>}
          </div>

          {loadingBooks ? (
            <p className="text-sm text-slate-400" role="status">Loading books…</p>
          ) : books.length === 0 ? (
            <p className="text-sm text-slate-500">No books yet. Create the first collection below.</p>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {books.map((book) => (
                <li key={book.id}>
                  <button
                    type="button"
                    onClick={() => handleSelectBook(book.id)}
                    disabled={creatingBook || savingBook || deletingBook || savingEntry || Boolean(deletingEntryId)}
                    aria-pressed={selectedBookId === book.id}
                    className={`w-full rounded border px-3 py-2 text-left transition ${
                      selectedBookId === book.id
                        ? "border-emerald-500 bg-emerald-950/30"
                        : "border-slate-800 hover:border-slate-600"
                    }`}
                  >
                    <span className="block text-sm font-semibold text-slate-100">{book.title}</span>
                    <span className="mt-1 block text-xs text-slate-500">{book.summary || "No summary"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form className="space-y-2 border-t border-slate-800 pt-4" onSubmit={handleCreateBook}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">New book</h3>
            <div>
              <label htmlFor="new-lore-book-title" className="sr-only">Book title</label>
              <input
                id="new-lore-book-title"
                className="input-field"
                placeholder="Book title"
                value={newBookTitle}
                maxLength={180}
                required
                onChange={(event) => setNewBookTitle(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="new-lore-book-summary" className="sr-only">Short summary</label>
              <textarea
                id="new-lore-book-summary"
                rows={3}
                className="input-field"
                placeholder="What belongs in this collection?"
                value={newBookSummary}
                maxLength={500}
                onChange={(event) => setNewBookSummary(event.target.value)}
              />
            </div>
            <button type="submit" disabled={creatingBook || !newBookTitle.trim()} className="primary-button w-full">
              {creatingBook ? "Creating…" : "Create book"}
            </button>
          </form>
        </aside>

        <section className="section-card space-y-5" aria-label="Selected lore book">
          {selectedBook ? (
            <>
              {editingBookId === selectedBook.id ? (
                <form className="space-y-3 border-b border-slate-800 pb-5" onSubmit={handleUpdateBook}>
                  <div>
                    <label htmlFor="edit-lore-book-title" className="block text-xs font-semibold text-slate-400 mb-1">Book title <span aria-hidden="true">*</span></label>
                    <input
                      id="edit-lore-book-title"
                      className="input-field"
                      value={bookTitle}
                      maxLength={180}
                      required
                      onChange={(event) => setBookTitle(event.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="edit-lore-book-summary" className="block text-xs font-semibold text-slate-400 mb-1">Summary</label>
                    <textarea
                      id="edit-lore-book-summary"
                      className="input-field"
                      rows={3}
                      maxLength={500}
                      value={bookSummary}
                      onChange={(event) => setBookSummary(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" className="primary-button" disabled={savingBook || !bookTitle.trim()}>{savingBook ? "Saving…" : "Save book"}</button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={savingBook}
                      onClick={() => {
                        if (!bookEditDirty || window.confirm("Discard changes to this book?")) clearBookEditor();
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <header className="flex flex-col gap-3 border-b border-slate-800 pb-5 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="section-label">Selected book</p>
                    <h2 className="mt-1 text-xl font-semibold text-slate-100">{selectedBook.title}</h2>
                    <p className="mt-1 text-sm text-slate-400">{selectedBook.summary || "No summary yet."}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button type="button" className="secondary-button text-xs" onClick={startBookEdit} disabled={savingEntry || deletingBook}>Edit book</button>
                    <button
                      type="button"
                      className="text-xs text-red-300 hover:text-red-200 disabled:opacity-50"
                      onClick={handleDeleteBook}
                      disabled={deletingBook || savingEntry}
                    >
                      {deletingBook ? "Deleting…" : "Delete book"}
                    </button>
                  </div>
                </header>
              )}

              <section className="space-y-3" aria-labelledby="lore-entries-heading">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 id="lore-entries-heading" className="text-sm font-semibold text-slate-200">Entries</h3>
                    {!loadingEntries && <p className="mt-1 text-xs text-slate-500">{entries.length} chapter{entries.length === 1 ? "" : "s"}</p>}
                  </div>
                  {entriesLoadFailed && (
                    <button
                      type="button"
                      className="secondary-button text-xs"
                      onClick={() => {
                        if (!entryDraftDirty || window.confirm("Discard the current entry draft and retry loading?")) {
                          clearEntryEditor();
                          setEntriesReloadKey((key) => key + 1);
                        }
                      }}
                    >
                      Retry
                    </button>
                  )}
                </div>

                {loadingEntries ? (
                  <p className="text-sm text-slate-400" role="status">Loading entries…</p>
                ) : entries.length === 0 ? (
                  <p className="text-sm text-slate-500">No entries yet. Write the first chapter below.</p>
                ) : (
                  <div className="space-y-3">
                    {entries.map((entry) => (
                      <article key={entry.id} className="rounded-xl border border-slate-800 bg-slate-900/30 p-4 space-y-3">
                        <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <h4 className="font-semibold text-slate-100">{entry.title}</h4>
                            <time className="text-[11px] text-slate-500" dateTime={new Date(entry.created_at * 1000).toISOString()}>
                              {new Date(entry.created_at * 1000).toLocaleDateString()}
                            </time>
                          </div>
                          <div className="flex gap-3 text-xs">
                            <button type="button" className="text-sky-300 hover:text-sky-200" onClick={() => startEntryEdit(entry)} disabled={Boolean(savingEntry || deletingEntryId)}>Edit</button>
                            <button
                              type="button"
                              className="text-red-300 hover:text-red-200 disabled:opacity-50"
                              onClick={() => handleDeleteEntry(entry)}
                              disabled={Boolean(savingEntry || deletingEntryId)}
                              aria-label={`Delete ${entry.title}`}
                            >
                              {deletingEntryId === entry.id ? "Deleting…" : "Delete"}
                            </button>
                          </div>
                        </header>
                        <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">{entry.content}</p>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <div ref={entryEditorRef} className="border-t border-slate-800 pt-5">
                <form className="space-y-3" onSubmit={handleSaveEntry}>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-200">{editingEntry ? "Edit entry" : "New entry"}</h3>
                    <p className="mt-1 text-xs text-slate-500">{editingEntry ? "Update this chapter without changing its place in the book." : `Add a chapter to “${selectedBook.title}”.`}</p>
                  </div>
                  <div>
                    <label htmlFor="lore-entry-title" className="block text-xs font-semibold text-slate-400 mb-1">Entry title <span aria-hidden="true">*</span></label>
                    <input
                      id="lore-entry-title"
                      className="input-field"
                      value={entryTitle}
                      maxLength={180}
                      required
                      onChange={(event) => setEntryTitle(event.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="lore-entry-content" className="block text-xs font-semibold text-slate-400 mb-1">Content <span aria-hidden="true">*</span></label>
                    <textarea
                      id="lore-entry-content"
                      rows={10}
                      className="input-field"
                      value={entryContent}
                      maxLength={50000}
                      required
                      placeholder="Write the chapter or lore text here…"
                      onChange={(event) => setEntryContent(event.target.value)}
                    />
                    <p className="mt-1 text-right text-[11px] text-slate-500">{entryContent.length.toLocaleString()} / 50,000</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" className="primary-button" disabled={savingEntry || !entryTitle.trim() || !entryContent.trim()}>
                      {savingEntry ? "Saving…" : editingEntry ? "Save entry" : "Add entry"}
                    </button>
                    {entryDraftDirty && (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={savingEntry}
                        onClick={() => {
                          if (window.confirm("Discard this unsaved lore entry?")) clearEntryEditor();
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
              </div>
            </>
          ) : loadingBooks ? (
            <p className="text-sm text-slate-400" role="status">Loading lore library…</p>
          ) : (
            <div className="py-10 text-center">
              <h2 className="text-lg font-semibold text-slate-200">Start a lore collection</h2>
              <p className="mt-2 text-sm text-slate-500">Create a book to organize related long-form entries.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
