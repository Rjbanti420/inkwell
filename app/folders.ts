import type { Folder } from "./types.js";

export interface FolderDocument {
  id: string;
  folderId: string | null;
}

export function uniqueName(requested: string, existing: string[]): string {
  const base = requested.trim() || "Untitled";
  const names = new Set(existing.map((name) => name.trim().toLocaleLowerCase()));
  if (!names.has(base.toLocaleLowerCase())) return base;
  for (let number = 2; ; number += 1) {
    const candidate = `${base} ${number}`;
    if (!names.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

export function uniqueDocumentTitle(title: string, titles: string[]): string {
  return uniqueName(title, titles);
}

export function createFolder(folders: Folder[], id: string, name = "New folder"): Folder[] {
  const folder: Folder = {
    id,
    name: uniqueName(name, folders.map((item) => item.name)),
    expanded: true,
  };
  return [...folders, folder];
}

export function renameFolder(folders: Folder[], id: string, requestedName: string): Folder[] {
  const cleaned = requestedName.trim();
  if (!cleaned) return folders;
  const current = folders.find((folder) => folder.id === id);
  if (!current) return folders;
  const name = uniqueName(cleaned, folders.filter((folder) => folder.id !== id).map((folder) => folder.name));
  return folders.map((folder) => (folder.id === id ? { ...folder, name } : folder));
}

export function moveDocument<T extends FolderDocument>(
  documents: T[],
  documentId: string,
  folderId: string | null,
  folders: Folder[],
): T[] {
  if (folderId !== null && !folders.some((folder) => folder.id === folderId)) return documents;
  return documents.map((document) =>
    document.id === documentId ? { ...document, folderId } : document,
  );
}

export function deleteFolder<T extends FolderDocument>(
  folders: Folder[],
  documents: T[],
  folderId: string,
  deleteDocuments: boolean,
): { folders: Folder[]; documents: T[]; deletedDocumentIds: string[] } {
  const deletedDocumentIds = deleteDocuments
    ? documents.filter((document) => document.folderId === folderId).map((document) => document.id)
    : [];
  return {
    folders: folders.filter((folder) => folder.id !== folderId),
    documents: documents
      .filter((document) => !deletedDocumentIds.includes(document.id))
      .map((document) => document.folderId === folderId ? { ...document, folderId: null } : document),
    deletedDocumentIds,
  };
}

export function restoreFolders(value: unknown): Folder[] {
  if (!Array.isArray(value)) return [];
  const folders: Folder[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id)) continue;
    ids.add(item.id);
    const name = typeof item.name === "string" ? item.name.trim() : "";
    folders.push({
      id: item.id,
      name: uniqueName(name || "New folder", folders.map((folder) => folder.name)),
      expanded: item.expanded !== false,
    });
  }
  return folders;
}

export function restoreFolderId(value: unknown, folders: Folder[]): string | null {
  return typeof value === "string" && folders.some((folder) => folder.id === value) ? value : null;
}
