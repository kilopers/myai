<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Validation\ValidationException;

#[Fillable(['user_id', 'name', 'min_length', 'max_length', 'use_lower', 'use_upper', 'use_digits', 'use_symbols', 'symbols'])]
class PasswordGenerator extends Model
{
    protected function casts(): array
    {
        return [
            'min_length' => 'integer',
            'max_length' => 'integer',
            'use_lower' => 'boolean',
            'use_upper' => 'boolean',
            'use_digits' => 'boolean',
            'use_symbols' => 'boolean',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Сгенерировать пароль по алгоритму: случайная длина в [min, max],
     * по одному символу из каждого выбранного набора гарантированно,
     * остальное — из объединённого пула. Тасование — random_int.
     */
    public function generate(): string
    {
        $pools = [];
        if ($this->use_lower) {
            $pools[] = mb_str_split('abcdefghijklmnopqrstuvwxyz');
        }
        if ($this->use_upper) {
            $pools[] = mb_str_split('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
        }
        if ($this->use_digits) {
            $pools[] = mb_str_split('0123456789');
        }
        if ($this->use_symbols && $this->symbols) {
            $pools[] = mb_str_split($this->symbols);
        }
        if ($pools === []) {
            throw ValidationException::withMessages([
                'use' => 'В алгоритме не выбран ни один набор символов.',
            ]);
        }

        $length = random_int($this->min_length, $this->max_length);
        $chars = array_map(
            fn (array $pool) => $pool[random_int(0, count($pool) - 1)],
            $pools,
        );
        $all = array_merge(...$pools);
        while (count($chars) < $length) {
            $chars[] = $all[random_int(0, count($all) - 1)];
        }
        // Fisher–Yates — чтобы «обязательные» символы не стояли в начале.
        for ($i = count($chars) - 1; $i > 0; $i--) {
            $j = random_int(0, $i);
            [$chars[$i], $chars[$j]] = [$chars[$j], $chars[$i]];
        }

        return implode('', array_slice($chars, 0, $length));
    }
}
