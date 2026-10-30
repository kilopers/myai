<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Resend, Postmark, AWS, and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    // Webhook POST /api/desktop-release/sync из GitHub Actions (релиз десктопа)
    'release_sync' => [
        'token' => env('RELEASE_SYNC_TOKEN'),
    ],

    // Встроенный торрент-клиент: aria2-демон с JSON-RPC (сервис aria2
    // в docker-compose). download_dir — каталог загрузки в координатах
    // движка; у app/queue ему соответствует диск «torrents»
    // (storage/app/torrents), смонтированный в тот же bind-volume.
    'torrent' => [
        'rpc_url' => env('TORRENT_RPC_URL', 'http://127.0.0.1:6800/jsonrpc'),
        'rpc_secret' => env('TORRENT_RPC_SECRET'),
        'download_dir' => env('TORRENT_DOWNLOAD_DIR', '/downloads'),
    ],

];
