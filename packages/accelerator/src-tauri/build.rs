fn main() {
    // Expose bundled Aztec bb version at compile time
    if let Ok(version) = std::fs::read_to_string("AZTEC_VERSION") {
        println!("cargo:rustc-env=AZTEC_BB_VERSION={}", version.trim());
    } else {
        println!("cargo:rustc-env=AZTEC_BB_VERSION=unknown");
    }
    tauri_build::build()
}
