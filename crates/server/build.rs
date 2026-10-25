use std::process::Command;

fn git(args: &[&str]) -> Option<String> {
    let output = Command::new("git").args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

fn main() {
    println!("cargo:rerun-if-env-changed=WORKERS_CI_COMMIT_SHA");
    if let Some(log) = git(&[
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "logs/HEAD",
    ]) {
        println!("cargo:rerun-if-changed={log}");
    }
    let commit = std::env::var("WORKERS_CI_COMMIT_SHA")
        .ok()
        .filter(|sha| !sha.is_empty())
        .or_else(|| git(&["rev-parse", "HEAD"]))
        .unwrap_or_else(|| "unknown".to_string());
    println!("cargo:rustc-env=BUGSTACK_COMMIT={commit}");
}
