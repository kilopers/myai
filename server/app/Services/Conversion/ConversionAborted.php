<?php

namespace App\Services\Conversion;

use RuntimeException;

/**
 * Конвертация прервана: файл изменился (новое поколение очереди)
 * или ушёл в корзину посреди работы. Не ошибка — штатная отмена,
 * частичные производные удаляются джобой.
 */
class ConversionAborted extends RuntimeException {}
