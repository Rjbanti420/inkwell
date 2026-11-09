import assert from "node:assert/strict";
import test from "node:test";

const {
  createFolder,
  deleteFolder,
  moveDocument,
  renameFolder,
  restoreFolderId,
  restoreFolders,
  uniqueDocumentTitle,
} = await import("../ui/js/folders.js");

test("folders create with numbered unique names and reject blank renames", () => {
  const first = createFolder([], "f1");
  const second = createFolder(first, "f2");
  assert.deepEqual(first.map((folder) => folder.name), ["New folder"]);
  assert.deepEqual(second.map((folder) => folder.name), ["New folder", "New folder 2"]);
  assert.equal(renameFolder(second, "f1", "   "), second);
  assert.equal(renameFolder(second, "f1", "New folder 2")[0].name, "New folder 2 2");
});

test("documents move between a folder and the root", () => {
  const folders = createFolder([], "f1");
  const documents = [{ id: "d1", folderId: null }];
  const filed = moveDocument(documents, "d1", "f1", folders);
  assert.equal(filed[0].folderId, "f1");
  assert.equal(moveDocument(filed, "d1", "missing", folders)[0].folderId, "f1");
  assert.equal(moveDocument(filed, "d1", null, folders)[0].folderId, null);
});

test("folder deletion either roots documents or explicitly removes them", () => {
  const folders = createFolder([], "f1");
  const documents = [
    { id: "d1", folderId: "f1" },
    { id: "d2", folderId: null },
  ];
  const rooted = deleteFolder(folders, documents, "f1", false);
  assert.equal(rooted.folders.length, 0);
  assert.deepEqual(rooted.documents.map((document) => document.folderId), [null, null]);
  assert.deepEqual(rooted.deletedDocumentIds, []);

  const removed = deleteFolder(folders, documents, "f1", true);
  assert.deepEqual(removed.documents.map((document) => document.id), ["d2"]);
  assert.deepEqual(removed.deletedDocumentIds, ["d1"]);
});

test("folder assignments and expanded state survive persistence restore", () => {
  const folders = createFolder([], "f1", "Research");
  folders[0].expanded = false;
  const data = JSON.parse(JSON.stringify({ folders, documents: [{ id: "d1", folderId: "f1" }] }));
  const restored = restoreFolders(data.folders);
  assert.deepEqual(restored, folders);
  assert.equal(restoreFolderId(data.documents[0].folderId, restored), "f1");
  assert.equal(restoreFolderId("deleted-folder", restored), null);
});

test("duplicate document names receive stable numeric suffixes", () => {
  assert.equal(uniqueDocumentTitle("Untitled", ["Untitled"]), "Untitled 2");
  assert.equal(uniqueDocumentTitle("untitled", ["Untitled", "Untitled 2"]), "untitled 3");
});
