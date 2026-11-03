<?php

namespace Tests\Feature;

use App\Models\Board;
use App\Models\User;
use App\Services\BoardIcon;
use GuzzleHttp\Psr7\Request as Psr7Request;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Minishlink\WebPush\MessageSentReport;
use Minishlink\WebPush\SubscriptionInterface;
use Minishlink\WebPush\WebPush;
use Tests\TestCase;

/** Фейк WebPush: записывает отправки вместо реальных HTTP-запросов. */
class FakeWebPush extends WebPush
{
    /** @var array<int, array{endpoint:string, payload:array}> */
    public array $sent = [];

    public function __construct() {}

    public function sendOneNotification(
        SubscriptionInterface $subscription,
        ?string $payload = null,
        array $options = [],
        array $auth = [],
    ): MessageSentReport {
        $this->sent[] = [
            'endpoint' => $subscription->getEndpoint(),
            'payload' => json_decode((string) $payload, true),
        ];

        return new MessageSentReport(new Psr7Request('POST', 'https://push.example'));
    }
}

class BoardPwaTest extends TestCase
{
    use RefreshDatabase;

    private function subscribeBody(string $endpoint, ?string $url = null): array
    {
        return [
            'endpoint' => $endpoint,
            'url' => $url,
            'keys' => ['p256dh' => str_repeat('a', 88), 'auth' => str_repeat('b', 24)],
        ];
    }

    public function test_board_manifest_for_owner_and_guest(): void
    {
        $user = User::factory()->create();
        $board = Board::create(['user_id' => $user->id, 'name' => 'Проекты']);
        $this->actingAs($user)->postJson("/api/boards/{$board->id}/share-link")->assertOk();
        $board->refresh();

        // Манифест владельца по manifest_token — стартует на /boards/{id}
        $own = $this->getJson("/api/board-apps/{$board->manifest_token}/manifest")->assertOk();
        $this->assertSame('Проекты', $own->json('name'));
        $this->assertSame("/boards/{$board->id}", $own->json('start_url'));
        $this->assertSame("/boards/{$board->id}", $own->json('scope'));
        $this->assertSame('standalone', $own->json('display'));
        $this->assertCount(4, $own->json('icons'));
        $this->assertStringContainsString($board->manifest_token, $own->json('icons.0.src'));

        // Манифест гостя по share_token — стартует на /b/{token}
        $guest = $this->getJson("/api/board-apps/{$board->share_token}/manifest")->assertOk();
        $this->assertSame("/b/{$board->share_token}", $guest->json('start_url'));
        $this->assertStringContainsString('maskable-512.png', $guest->json('icons.3.src'));

        $this->getJson('/api/board-apps/unknown-token/manifest')->assertNotFound();
        // manifest_token не светится в гостевом ответе доски
        $this->assertNull($this->getJson("/api/public/boards/{$board->share_token}")->json('board.manifest_token'));
    }

    public function test_board_icon_generated_upload_and_reset(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $other = User::factory()->create();
        $board = Board::create(['user_id' => $user->id, 'name' => 'Дизайн', 'prefix' => 'DS']);

        // Автоиконка генерится на лету — PNG по обоим токенам и в списке
        $res = $this->get("/api/board-apps/{$board->manifest_token}/icons/icon-192.png");
        $res->assertOk()->assertHeader('Content-Type', 'image/png');
        $this->assertSame('image/png', getimagesizefromstring($res->streamedContent())['mime'] ?? null);

        $list = $this->actingAs($user)->getJson('/api/boards?all=1')->assertOk()->json();
        $this->assertStringContainsString(
            "/api/board-apps/{$board->manifest_token}/icons/icon-192.png", $list[0]['icon_url']
        );

        // Своя картинка: загрузка → производные на диске
        $file = UploadedFile::fake()->image('icon.png', 400, 300);
        $this->actingAs($user)->postJson("/api/boards/{$board->id}/icon", ['icon' => $file])
            ->assertCreated()->assertJsonStructure(['icon_url']);
        foreach (['icon-192.png', 'icon-512.png', 'maskable-192.png', 'maskable-512.png'] as $f) {
            Storage::disk('public')->assertExists("board-icons/{$board->id}/{$f}");
        }
        $this->assertNotNull($board->fresh()->icon);

        // Чужой пользователь — 403
        $this->actingAs($other)->postJson("/api/boards/{$board->id}/icon", [
            'icon' => UploadedFile::fake()->image('x.png'),
        ])->assertForbidden();

        // Сброс → автоиконка
        $this->actingAs($user)->deleteJson("/api/boards/{$board->id}/icon")
            ->assertOk()->assertJsonStructure(['icon_url']);
        $this->assertNull($board->fresh()->icon);
    }

    public function test_generated_icon_letters_are_centered(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();

        foreach ([['prefix' => 'DS', 'name' => 'Доска'], ['name' => 'Щиты']] as $attrs) {
            $board = Board::create(['user_id' => $user->id] + $attrs);
            app(BoardIcon::class)->generate($board);

            $img = imagecreatefromstring(
                Storage::disk('public')->get("board-icons/{$board->id}/icon-512.png")
            );
            $bg = imagecolorat($img, 0, 0);
            [$minX, $minY, $maxX, $maxY] = [512, 512, -1, -1];
            for ($y = 0; $y < 512; $y++) {
                for ($x = 0; $x < 512; $x++) {
                    if (imagecolorat($img, $x, $y) !== $bg) {
                        $minX = min($minX, $x);
                        $maxX = max($maxX, $x);
                        $minY = min($minY, $y);
                        $maxY = max($maxY, $y);
                    }
                }
            }

            // Центр букв — в пределах 2% от центра холста (двухбуквенный
            // prefix и кириллица с выносными элементами).
            $this->assertEqualsWithDelta(256, ($minX + $maxX) / 2, 10, $board->name.' X');
            $this->assertEqualsWithDelta(256, ($minY + $maxY) / 2, 10, $board->name.' Y');
        }
    }

    public function test_push_subscriptions_owner_and_guest(): void
    {
        $user = User::factory()->create();
        $board = Board::create(['user_id' => $user->id, 'name' => 'B']);
        $this->actingAs($user)->postJson("/api/boards/{$board->id}/share-link")->assertOk();
        $token = $board->fresh()->share_token;
        $ep = 'https://push.example/sub/'.bin2hex(random_bytes(8));

        // Владелец подписывается → запись с user_id и страницей доски
        $this->actingAs($user)->postJson("/api/boards/{$board->id}/push-subscription",
            $this->subscribeBody($ep, "/boards/{$board->id}"))->assertCreated();
        $this->assertDatabaseHas('push_subscriptions', [
            'board_id' => $board->id, 'user_id' => $user->id, 'endpoint' => $ep,
        ]);

        // Повторная подписка тем же endpoint — обновление, а не дубль
        $this->actingAs($user)->postJson("/api/boards/{$board->id}/push-subscription",
            $this->subscribeBody($ep, '/boards/other'))->assertCreated();
        $this->assertSame(1, $board->pushSubscriptions()->count());

        // Гость подписывается по share_token — user_id NULL
        $gep = 'https://push.example/sub/'.bin2hex(random_bytes(8));
        $this->postJson("/api/public/boards/{$token}/push-subscription",
            $this->subscribeBody($gep, "/b/{$token}"))->assertCreated();
        $this->assertDatabaseHas('push_subscriptions', [
            'board_id' => $board->id, 'user_id' => null, 'endpoint' => $gep,
        ]);

        // Отписка гостя и владельца
        $this->deleteJson("/api/public/boards/{$token}/push-subscription", ['endpoint' => $gep])
            ->assertNoContent();
        $this->actingAs($user)->deleteJson("/api/boards/{$board->id}/push-subscription",
            ['endpoint' => $ep])->assertNoContent();
        $this->assertSame(0, $board->pushSubscriptions()->count());

        // Чужая доска и невалидное тело — 403/422/404
        $other = User::factory()->create();
        $this->actingAs($other)->postJson("/api/boards/{$board->id}/push-subscription",
            $this->subscribeBody($ep))->assertForbidden();
        $this->actingAs($user)->postJson("/api/boards/{$board->id}/push-subscription",
            ['endpoint' => 'x'])->assertUnprocessable();
        $this->postJson('/api/public/boards/nope/push-subscription',
            $this->subscribeBody($ep))->assertNotFound();
    }

    public function test_pushes_go_only_to_own_board_subscribers(): void
    {
        Storage::fake('public');
        $fake = new FakeWebPush;
        $this->instance(WebPush::class, $fake);
        config()->set('services.webpush.vapid.publicKey', 'pub');
        config()->set('services.webpush.vapid.privateKey', 'priv');

        $user = User::factory()->create();
        $boardA = Board::create(['user_id' => $user->id, 'name' => 'А', 'prefix' => 'A']);
        $boardB = Board::create(['user_id' => $user->id, 'name' => 'Б']);
        $colA = $boardA->columns()->create(['name' => 'C', 'position' => 0]);
        $colB = $boardB->columns()->create(['name' => 'C', 'position' => 0]);
        $this->actingAs($user)->postJson("/api/boards/{$boardA->id}/share-link")->assertOk();
        $tokenA = $boardA->fresh()->share_token;

        // Подписчики: владелец на обеих досках + гость доски А
        $epA = 'https://push.example/a';
        $epB = 'https://push.example/b';
        $epGuest = 'https://push.example/g';
        $this->actingAs($user)->postJson("/api/boards/{$boardA->id}/push-subscription",
            $this->subscribeBody($epA, "/boards/{$boardA->id}"))->assertCreated();
        $this->actingAs($user)->postJson("/api/boards/{$boardB->id}/push-subscription",
            $this->subscribeBody($epB, "/boards/{$boardB->id}"))->assertCreated();
        $this->postJson("/api/public/boards/{$tokenA}/push-subscription",
            $this->subscribeBody($epGuest, "/b/{$tokenA}"))->assertCreated();

        // Новая задача на доске А: пуши только подписчикам А
        $this->actingAs($user)->postJson('/api/board-tasks', [
            'board_column_id' => $colA->id, 'title' => 'Первая',
        ])->assertCreated();

        $endpoints = array_column($fake->sent, 'endpoint');
        $this->assertCount(2, $fake->sent);
        $this->assertContains($epA, $endpoints);
        $this->assertContains($epGuest, $endpoints);
        $this->assertNotContains($epB, $endpoints);

        // У владельца ссылка ведёт на /boards/{id}?task=A-1, у гостя — на /b/{token}
        $byEp = collect($fake->sent)->keyBy('endpoint');
        $this->assertSame("/boards/{$boardA->id}?task=A-1", $byEp[$epA]['payload']['url']);
        $this->assertSame("/b/{$tokenA}?task=A-1", $byEp[$epGuest]['payload']['url']);
        $this->assertSame('А', $byEp[$epA]['payload']['title']);
        $this->assertStringContainsString('Первая', $byEp[$epA]['payload']['body']);
        $this->assertStringContainsString($boardA->manifest_token, $byEp[$epA]['payload']['icon']);
        $this->assertStringContainsString($tokenA, $byEp[$epGuest]['payload']['icon']);

        // exclude_endpoint: автор действия пуша не получает
        $fake->sent = [];
        $this->actingAs($user)->postJson('/api/board-tasks', [
            'board_column_id' => $colA->id, 'title' => 'Вторая',
            'exclude_endpoint' => $epA,
        ])->assertCreated();
        $this->assertSame([$epGuest], array_column($fake->sent, 'endpoint'));

        // Комментарий гостя на доске А — тоже событие для пуша
        $fake->sent = [];
        $task = $colA->tasks()->first();
        $this->postJson("/api/public/boards/{$tokenA}/board-task-comments", [
            'board_task_id' => $task->id, 'guest_name' => 'Иван', 'text' => 'Привет',
            'exclude_endpoint' => $epGuest,
        ])->assertCreated();
        $this->assertSame([$epA], array_column($fake->sent, 'endpoint'));
        $this->assertStringContainsString('Иван', $fake->sent[0]['payload']['body']);

        // Задача на доске Б — только её подписчик
        $fake->sent = [];
        $this->actingAs($user)->postJson('/api/board-tasks', [
            'board_column_id' => $colB->id, 'title' => 'На Б',
        ])->assertCreated();
        $this->assertSame([$epB], array_column($fake->sent, 'endpoint'));
    }

    public function test_guest_push_subscriptions_removed_on_share_revoke(): void
    {
        $user = User::factory()->create();
        $board = Board::create(['user_id' => $user->id, 'name' => 'B']);
        $this->actingAs($user)->postJson("/api/boards/{$board->id}/share-link")->assertOk();
        $token = $board->fresh()->share_token;

        $this->postJson("/api/public/boards/{$token}/push-subscription",
            $this->subscribeBody('https://push.example/g', "/b/{$token}"))->assertCreated();
        $this->actingAs($user)->postJson("/api/boards/{$board->id}/push-subscription",
            $this->subscribeBody('https://push.example/o', "/boards/{$board->id}"))->assertCreated();

        // Отзыв ссылки сносит только гостевые подписки
        $this->actingAs($user)->deleteJson("/api/boards/{$board->id}/share-link")->assertNoContent();
        $this->assertSame(1, $board->pushSubscriptions()->count());
        $this->assertNotNull($board->pushSubscriptions()->first()->user_id);
    }
}
