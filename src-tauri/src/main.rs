#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Deserialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri_plugin_dialog::DialogExt;

/// Files passed by the desktop launcher or shell, consumed once by the frontend.
struct StartupFiles(Mutex<Vec<String>>);

fn collect_startup_files() -> Vec<String> {
    let mut seen = HashSet::new();
    std::env::args_os()
        .skip(1)
        .filter_map(|arg| {
            let arg = arg.to_string_lossy();
            if arg.starts_with('-') {
                return None;
            }
            let path = PathBuf::from(arg.as_ref()).canonicalize().ok()?;
            if !path.is_file() {
                return None;
            }
            let path = path.to_string_lossy().into_owned();
            seen.insert(path.clone()).then_some(path)
        })
        .collect()
}

#[tauri::command]
fn take_startup_files(state: tauri::State<StartupFiles>) -> Vec<String> {
    state
        .0
        .lock()
        .map(|mut files| std::mem::take(&mut *files))
        .unwrap_or_default()
}

fn path_of(file: tauri_plugin_dialog::FilePath) -> Option<String> {
    file.into_path()
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

/// Native "open" dialog. Returns the chosen path, or None when cancelled.
#[tauri::command]
async fn pick_open(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .set_title("Open Markdown file")
        .add_filter("Markdown", &["md", "markdown", "mdown", "txt"])
        .blocking_pick_file()
        .and_then(path_of)
}

/// Native "save as" dialog. Returns the chosen path, or None when cancelled.
#[tauri::command]
async fn pick_save(app: tauri::AppHandle, default_name: String) -> Option<String> {
    app.dialog()
        .file()
        .set_title("Save Markdown file")
        .set_file_name(default_name)
        .add_filter("Markdown", &["md", "markdown"])
        .blocking_save_file()
        .and_then(path_of)
}

#[tauri::command]
async fn pick_export_directory(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .set_title("Export folder contents")
        .blocking_pick_folder()
        .and_then(path_of)
}

#[derive(Deserialize)]
struct FolderFile {
    name: String,
    contents: String,
}

fn markdown_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|ch| {
            if ch.is_control() || matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
            {
                '-'
            } else {
                ch
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_end_matches(&[' ', '.'][..]);
    let base = if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        "Untitled"
    } else {
        cleaned
    };
    if base.to_ascii_lowercase().ends_with(".md") {
        base.to_owned()
    } else {
        format!("{base}.md")
    }
}

fn unique_export_path(directory: &Path, requested: &str, used: &mut HashSet<String>) -> PathBuf {
    let filename = markdown_filename(requested);
    let path = Path::new(&filename);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Untitled")
        .to_owned();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("md")
        .to_owned();
    let mut candidate = filename;
    let mut number = 2;
    loop {
        let key = candidate.to_lowercase();
        let full_path = directory.join(&candidate);
        if used.insert(key) && !full_path.exists() {
            return full_path;
        }
        candidate = format!("{stem} {number}.{extension}");
        number += 1;
    }
}

#[tauri::command]
fn write_folder_files(directory: String, files: Vec<FolderFile>) -> Result<usize, String> {
    let directory = PathBuf::from(directory);
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create export folder: {error}"))?;
    let mut used = HashSet::new();
    for file in &files {
        let path = unique_export_path(&directory, &file.name, &mut used);
        std::fs::write(&path, &file.contents)
            .map_err(|error| format!("Could not export {}: {error}", path.display()))?;
    }
    Ok(files.len())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Could not read {path}: {e}"))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Could not create folder: {e}"))?;
    }
    std::fs::write(&path, contents).map_err(|e| format!("Could not save {path}: {e}"))
}

fn main() {
    tauri::Builder::default()
        .manage(StartupFiles(Mutex::new(collect_startup_files())))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            pick_open,
            pick_save,
            pick_export_directory,
            write_folder_files,
            read_text_file,
            write_text_file,
            take_startup_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running Inkwell");
}

#[cfg(test)]
mod tests {
    use super::{markdown_filename, unique_export_path};
    use std::collections::HashSet;
    use std::path::Path;

    #[test]
    fn export_names_are_safe_markdown_names_and_duplicates_are_numbered() {
        assert_eq!(markdown_filename("../../Draft"), "..-..-Draft.md");
        let mut used = HashSet::new();
        assert_eq!(
            unique_export_path(
                Path::new("/path/that/does/not/exist"),
                "Notes.md",
                &mut used
            ),
            Path::new("/path/that/does/not/exist/Notes.md")
        );
        assert_eq!(
            unique_export_path(
                Path::new("/path/that/does/not/exist"),
                "notes.MD",
                &mut used
            ),
            Path::new("/path/that/does/not/exist/notes 2.MD")
        );
    }
}
