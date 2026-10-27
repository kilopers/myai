//! Захват экрана через ScreenCaptureKit (macOS 14+).
//!
//! xcap использует устаревший CGWindowListCreateImage — macOS 15+
//! из-за этого периодически переспрашивает разрешение «Запись экрана».
//! SCK работает через постоянный TCC-грант без напоминаний.

use std::ptr::NonNull;
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use image::RgbaImage;
use objc2::runtime::AnyClass;
use objc2::{msg_send, sel};
use objc2_core_foundation::{CFRetained, CGPoint, CGRect, CGSize};
use objc2_core_graphics::{
    CGDataProvider, CGImage, CGPreflightScreenCaptureAccess, CGRequestScreenCaptureAccess,
};
use objc2_foundation::NSError;
use objc2_screen_capture_kit::SCScreenshotManager;

/// captureImageInRect появился в macOS 14 — проверяем в рантайме,
/// чтобы на старых системах отработал фолбэк на xcap.
pub fn available() -> bool {
    let Some(cls) = AnyClass::get(c"SCScreenshotManager") else {
        return false;
    };
    unsafe {
        msg_send![cls, respondsToSelector: sel!(captureImageInRect:completionHandler:)]
    }
}

/// Префлайт/запрос права «Запись экрана» (SCK-путь выдаёт постоянный грант).
pub fn ensure_permission() -> bool {
    CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess()
}

/// Снимок монитора Tauri целиком: координаты окна — физические пиксели,
/// SCK ждёт прямоугольник в пунктах глобального пространства экрана.
pub fn capture_monitor(monitor: &tauri::window::Monitor) -> Result<RgbaImage, String> {
    let scale = monitor.scale_factor();
    let pos = monitor.position();
    let size = monitor.size();
    let rect = CGRect::new(
        CGPoint::new(pos.x as f64 / scale, pos.y as f64 / scale),
        CGSize::new(size.width as f64 / scale, size.height as f64 / scale),
    );
    capture_rect(rect)
}

pub fn capture_rect(rect: CGRect) -> Result<RgbaImage, String> {
    let (tx, rx) = mpsc::channel::<Result<CFRetained<CGImage>, String>>();

    let handler = RcBlock::new(move |image: *mut CGImage, error: *mut NSError| {
        let result = match NonNull::new(image) {
            Some(ptr) => unsafe { Ok(CFRetained::retain(ptr)) },
            None => Err(if let Some(err) = NonNull::new(error) {
                let err = unsafe { &*err.as_ptr() };
                format!("ScreenCaptureKit: {}", err.localizedDescription())
            } else {
                "ScreenCaptureKit: нет изображения".to_string()
            }),
        };
        let _ = tx.send(result);
    });

    unsafe {
        SCScreenshotManager::captureImageInRect_completionHandler(rect, Some(&handler));
    }

    let image = rx
        .recv_timeout(Duration::from_secs(15))
        .map_err(|_| "ScreenCaptureKit: таймаут захвата".to_string())??;

    cgimage_to_rgba(&image)
}

/// CGImage (BGRA, как и у CGWindowList) → RgbaImage — та же раскладка,
/// что в xcap::capture, плюс защита от хвостовых байтов в строке.
fn cgimage_to_rgba(cg_image: &CGImage) -> Result<RgbaImage, String> {
    let width = CGImage::width(Some(cg_image));
    let height = CGImage::height(Some(cg_image));
    if width == 0 || height == 0 {
        return Err("ScreenCaptureKit: пустое изображение".into());
    }
    let provider =
        CGImage::data_provider(Some(cg_image)).ok_or("ScreenCaptureKit: нет data provider")?;
    let data = CGDataProvider::data(Some(&provider))
        .ok_or("ScreenCaptureKit: не удалось скопировать данные")?
        .to_vec();
    let bytes_per_row = CGImage::bytes_per_row(Some(cg_image));
    if bytes_per_row < width * 4 {
        return Err("ScreenCaptureKit: неожиданный формат пикселей".into());
    }

    let mut buffer = Vec::with_capacity(width * height * 4);
    for row in data.chunks_exact(bytes_per_row) {
        buffer.extend_from_slice(&row[..width * 4]);
    }
    for bgra in buffer.chunks_exact_mut(4) {
        bgra.swap(0, 2);
    }

    RgbaImage::from_raw(width as u32, height as u32, buffer)
        .ok_or_else(|| "RgbaImage::from_raw failed".to_string())
}
