//! `debriddownloader-headless`: the download engine and HTTP API without a window.
//! Build with `cargo build --no-default-features --features headless --bin debriddownloader-headless`.
//! Flags and env vars are documented in `debriddownloader_lib::headless`.

fn main() -> std::process::ExitCode {
    debriddownloader_lib::headless::main()
}
