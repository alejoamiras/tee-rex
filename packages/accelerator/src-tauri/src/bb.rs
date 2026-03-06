use std::path::PathBuf;

/// Find the `bb` binary. Search order:
/// 1. Bundled sidecar (Tauri externalBin) — `binaries/bb-{target-triple}` next to the executable
/// 2. `~/.bb/bb` — user-installed via `bbup`
/// 3. `bb` on `$PATH`
pub fn find_bb() -> Result<PathBuf, String> {
    // 1. Sidecar: check next to the current executable
    if let Ok(exe) = std::env::current_exe() {
        let sidecar = exe.parent().unwrap_or(&exe).join("bb");
        if sidecar.exists() {
            return Ok(sidecar);
        }
    }

    // 2. ~/.bb/bb (bbup install location)
    if let Some(home) = dirs_next().or_else(home_dir_fallback) {
        let bbup_path = home.join(".bb").join("bb");
        if bbup_path.exists() {
            return Ok(bbup_path);
        }
    }

    // 3. bb on $PATH
    if let Ok(path) = which::which("bb") {
        return Ok(path);
    }

    Err("bb binary not found. Install via bbup or bundle as sidecar.".to_string())
}

fn dirs_next() -> Option<PathBuf> {
    dirs::home_dir()
}

fn home_dir_fallback() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(PathBuf::from)
}

/// Run `bb prove` on the given IVC inputs (msgpack bytes) and return the proof
/// with a 4-byte BE field-count header suitable for `ChonkProofWithPublicInputs.fromBuffer()`.
pub async fn prove(ivc_inputs: &[u8]) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    let bb_path =
        find_bb().map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { e.into() })?;

    let tmp_dir = tempfile::tempdir()?;
    let input_path = tmp_dir.path().join("ivc-inputs.msgpack");
    let output_dir = tmp_dir.path().join("output");
    std::fs::create_dir_all(&output_dir)?;
    std::fs::write(&input_path, ivc_inputs)?;

    tracing::info!(
        bb = %bb_path.display(),
        input = %input_path.display(),
        "Starting bb prove"
    );

    let output = tokio::process::Command::new(&bb_path)
        .args([
            "prove",
            "--scheme",
            "chonk",
            "--ivc_inputs_path",
            input_path.to_str().unwrap(),
            "-o",
            output_dir.to_str().unwrap(),
        ])
        .output()
        .await?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.is_empty() {
        tracing::info!("bb stderr:\n{stderr}");
    }

    if !output.status.success() {
        return Err(format!("bb prove failed (exit {}): {stderr}", output.status).into());
    }

    let proof_path = output_dir.join("proof");
    let raw_proof = std::fs::read(&proof_path)?;

    tracing::info!(proof_bytes = raw_proof.len(), "bb prove completed");

    Ok(prepend_field_count_header(&raw_proof))
}

/// Prepend a 4-byte big-endian uint32 field count header.
/// Each field is 32 bytes, so field_count = raw_len / 32.
fn prepend_field_count_header(raw_proof: &[u8]) -> Vec<u8> {
    let field_count = (raw_proof.len() / 32) as u32;
    let mut result = Vec::with_capacity(4 + raw_proof.len());
    result.extend_from_slice(&field_count.to_be_bytes());
    result.extend_from_slice(raw_proof);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prepend_field_count_header() {
        // 64 bytes = 2 fields of 32 bytes each
        let raw = vec![0xAB; 64];
        let result = prepend_field_count_header(&raw);

        assert_eq!(result.len(), 68); // 4 header + 64 data
        assert_eq!(&result[0..4], &[0, 0, 0, 2]); // 2 fields, big-endian
        assert_eq!(&result[4..], &raw[..]);
    }

    #[test]
    fn test_prepend_field_count_header_empty() {
        let raw = vec![];
        let result = prepend_field_count_header(&raw);

        assert_eq!(result.len(), 4);
        assert_eq!(&result[0..4], &[0, 0, 0, 0]);
    }

    #[test]
    fn test_prepend_field_count_header_single_field() {
        let raw = vec![0xFF; 32];
        let result = prepend_field_count_header(&raw);

        assert_eq!(result.len(), 36);
        assert_eq!(&result[0..4], &[0, 0, 0, 1]); // 1 field
    }

    #[test]
    fn test_find_bb_resolution_priority() {
        // This test verifies find_bb returns an error when no bb is available,
        // which is the expected state in CI/test environments.
        // When bb IS available (via PATH or ~/.bb/bb), it should succeed.
        let result = find_bb();
        // We can't assert Ok/Err since it depends on the environment,
        // but we can verify the function doesn't panic.
        match result {
            Ok(path) => assert!(path.exists()),
            Err(msg) => assert!(msg.contains("bb binary not found")),
        }
    }
}
