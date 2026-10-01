use thiserror::Error;

use super::MAX_LINE_BYTES;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum LineCodecError {
    #[error("sidecar line exceeds the 8 MiB limit")]
    Overlong,
    #[error("sidecar line is not valid UTF-8")]
    InvalidUtf8,
}

#[derive(Default)]
pub struct LineCodec {
    buffer: Vec<u8>,
    dropping_overlong: bool,
}

impl LineCodec {
    pub fn push(&mut self, bytes: &[u8]) -> Vec<Result<String, LineCodecError>> {
        let mut lines = Vec::new();

        for byte in bytes {
            if *byte == b'\n' {
                if self.dropping_overlong {
                    lines.push(Err(LineCodecError::Overlong));
                    self.dropping_overlong = false;
                    self.buffer.clear();
                } else {
                    lines.push(self.take_line());
                }
            } else if !self.dropping_overlong {
                if self.buffer.len() == MAX_LINE_BYTES {
                    self.buffer.clear();
                    self.dropping_overlong = true;
                } else {
                    self.buffer.push(*byte);
                }
            }
        }

        lines
    }

    pub fn finish(&mut self) -> Option<Result<String, LineCodecError>> {
        if self.dropping_overlong {
            self.dropping_overlong = false;
            self.buffer.clear();
            return Some(Err(LineCodecError::Overlong));
        }
        if self.buffer.is_empty() {
            return None;
        }
        Some(self.take_line())
    }

    fn take_line(&mut self) -> Result<String, LineCodecError> {
        if self.buffer.last() == Some(&b'\r') {
            self.buffer.pop();
        }
        let bytes = std::mem::take(&mut self.buffer);
        String::from_utf8(bytes).map_err(|_| LineCodecError::InvalidUtf8)
    }
}

#[cfg(test)]
mod tests {
    use super::{LineCodec, LineCodecError, MAX_LINE_BYTES};

    #[test]
    fn frames_lines_across_partial_reads() {
        let mut codec = LineCodec::default();
        assert!(codec.push(b"{\"method\":").is_empty());
        assert_eq!(
            codec.push(b"\"one\"}\nnext\n"),
            vec![
                Ok("{\"method\":\"one\"}".to_string()),
                Ok("next".to_string())
            ]
        );
    }

    #[test]
    fn strips_cr_from_crlf_lines() {
        let mut codec = LineCodec::default();
        assert_eq!(codec.push(b"value\r\n"), vec![Ok("value".to_string())]);
    }

    #[test]
    fn drops_one_overlong_line_and_recovers() {
        let mut codec = LineCodec::default();
        let mut bytes = vec![b'x'; MAX_LINE_BYTES + 1];
        bytes.extend_from_slice(b"\nvalid\n");
        let lines = codec.push(&bytes);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0], Err(LineCodecError::Overlong));
        assert_eq!(lines[1], Ok("valid".to_string()));
    }
}
