//! Windows DPAPI helpers for API keys at rest.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::ptr;
use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
};

const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

fn as_blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    }
}

unsafe fn take_blob(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
    unsafe {
        let bytes = std::slice::from_raw_parts(
            out.pbData,
            out.cbData as usize,
        )
        .to_vec();
        LocalFree(out.pbData as *mut core::ffi::c_void);
        bytes
    }
}

pub fn protect(plain: &str) -> Result<String, String> {
    let data = plain.as_bytes();
    let input = as_blob(data);

    unsafe {
        let mut out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        };
        let ok = CryptProtectData(
            &input,
            ptr::null(),
            ptr::null(),
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out,
        );
        if ok == 0 {
            return Err("DPAPI CryptProtectData failed".into());
        }
        Ok(STANDARD.encode(take_blob(out)))
    }
}

pub fn unprotect(encoded: &str) -> Result<String, String> {
    let raw = STANDARD
        .decode(encoded)
        .map_err(|e| format!("secret decode failed: {e}"))?;
    let input = as_blob(&raw);

    unsafe {
        let mut out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        };
        let ok = CryptUnprotectData(
            &input,
            ptr::null_mut(),
            ptr::null(),
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out,
        );
        if ok == 0 {
            return Err("DPAPI CryptUnprotectData failed".into());
        }
        String::from_utf8(take_blob(out))
            .map_err(|e| format!("secret is not utf-8: {e}"))
    }
}
