/// Maximum allowed width/height in pixels for mascot images.
pub const MAX_DIMENSION: u32 = 512;

const PNG_SIGNATURE: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

/// Validates PNG bytes and returns `(width, height)` on success.
///
/// Only the signature and the IHDR header are inspected; full decoding is
/// unnecessary because the webview performs the actual rendering.
pub fn validate_png(bytes: &[u8]) -> Result<(u32, u32), String> {
    // PNGは先頭にシグネチャ8バイト+IHDRチャンク(長さ4+種別4+幅4+高さ4)が
    // 固定で並ぶため、最低24バイトを要求する
    if bytes.len() < 24 || bytes[..8] != PNG_SIGNATURE {
        return Err("The selected file is not a PNG image".to_string());
    }
    if &bytes[12..16] != b"IHDR" {
        return Err("The selected file is not a valid PNG image".to_string());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().expect("slice length is 4"));
    let height = u32::from_be_bytes(bytes[20..24].try_into().expect("slice length is 4"));
    if width == 0 || height == 0 {
        return Err("The selected file is not a valid PNG image".to_string());
    }
    if width > MAX_DIMENSION || height > MAX_DIMENSION {
        return Err(format!(
            "Image is {}x{}px; both dimensions must be at most {}px",
            width, height, MAX_DIMENSION
        ));
    }
    Ok((width, height))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds the fixed-size prefix of a PNG file (signature + IHDR).
    fn png_header(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        bytes.extend_from_slice(&13u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        // ビット深度・カラータイプ等。寸法検証には使わないためダミー値でよい
        bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes
    }

    #[test]
    fn test_accepts_png_at_max_dimension() {
        assert_eq!(validate_png(&png_header(512, 512)), Ok((512, 512)));
    }

    #[test]
    fn test_accepts_small_png() {
        assert_eq!(validate_png(&png_header(1, 1)), Ok((1, 1)));
    }

    #[test]
    fn test_rejects_too_wide_png() {
        let err = validate_png(&png_header(513, 100)).unwrap_err();
        assert!(
            err.contains("513x100"),
            "message should include dimensions: {}",
            err
        );
    }

    #[test]
    fn test_rejects_too_tall_png() {
        assert!(validate_png(&png_header(100, 513)).is_err());
    }

    #[test]
    fn test_rejects_non_png_bytes() {
        assert!(validate_png(b"GIF89a not a png at all......").is_err());
    }

    #[test]
    fn test_rejects_truncated_file() {
        assert!(validate_png(&[0x89, 0x50, 0x4E, 0x47]).is_err());
    }

    #[test]
    fn test_rejects_zero_dimension() {
        assert!(validate_png(&png_header(0, 100)).is_err());
    }
}
