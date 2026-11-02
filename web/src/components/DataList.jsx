import {
  Box,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';

/**
 * Единый список справочника: на десктопе — MUI-таблица,
 * на мобильной — карточки (название первой колонки + пары
 * «метка: значение» остальных). columns: [{key,label,render,align}],
 * actions(row) → элементы действий в конце, onRow(row) → клик по строке.
 */
export default function DataList({ columns, rows, actions, empty = 'Нет записей', onRow }) {
  if (!rows?.length) {
    return (
      <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
        {empty}
      </Typography>
    );
  }

  const cell = (c, row) => (c.render ? c.render(row) : row[c.key]);

  return (
    <>
      {/* мобильный вид — карточки */}
      <Box sx={{ display: { xs: 'flex', sm: 'none' }, flexDirection: 'column', gap: 1.5 }}>
        {rows.map((row) => (
          <Card
            key={row.id}
            variant="outlined"
            onClick={onRow ? () => onRow(row) : undefined}
            sx={{
              borderRadius: '16px',
              borderColor: (t) => t.alpha(t.palette.primary.main, 0.14),
              cursor: onRow ? 'pointer' : undefined,
            }}
          >
            <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Typography sx={{ fontWeight: 600, mb: 0.5 }}>
                {cell(columns[0], row)}
              </Typography>
              <Box component="dl" sx={{ m: 0, fontSize: '0.85rem' }}>
                {columns.slice(1).map((c) => (
                  <Box key={c.key} sx={{ display: 'flex', gap: 1, mb: 0.25 }}>
                    <Box component="dt" sx={{ width: '38%', flexShrink: 0, color: 'text.secondary' }}>
                      {c.label}
                    </Box>
                    <Box component="dd" sx={{ m: 0, minWidth: 0, wordBreak: 'break-word' }}>
                      {cell(c, row)}
                    </Box>
                  </Box>
                ))}
              </Box>
              {actions ? (
                <Box sx={{ display: 'flex', gap: 1, mt: 1, pt: 0.75, borderTop: '1px solid', borderColor: 'divider' }}>
                  {actions(row)}
                </Box>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </Box>
      {/* десктоп — таблица в скруглённой рамке с градиентной шапкой */}
      <Box sx={{
        display: { xs: 'none', sm: 'block' },
        overflowX: 'auto',
        border: 1,
        borderColor: (t) => t.alpha(t.palette.primary.main, 0.14),
        borderRadius: '16px',
        bgcolor: 'background.paper',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}
      >
        <Table size="small">
          <TableHead>
            <TableRow sx={{
              background: (t) => `linear-gradient(90deg,
                ${t.alpha(t.palette.primary.main, 0.10)},
                ${t.alpha(t.palette.primary.main, 0.05)})`,
            }}
            >
              {columns.map((c) => (
                <TableCell
                  key={c.key}
                  align={c.align}
                  sx={{ fontWeight: 600, color: 'text.secondary', borderBottom: 0, py: 1.25 }}
                >
                  {c.label}
                </TableCell>
              ))}
              {actions ? <TableCell sx={{ borderBottom: 0 }} /> : null}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                onClick={onRow ? () => onRow(row) : undefined}
                sx={{
                  cursor: onRow ? 'pointer' : undefined,
                  '&:hover': { bgcolor: (t) => t.alpha(t.palette.primary.main, 0.05) },
                  '&:last-child td': { borderBottom: 0 },
                }}
              >
                {columns.map((c) => (
                  <TableCell key={c.key} align={c.align}>{cell(c, row)}</TableCell>
                ))}
                {actions ? <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{actions(row)}</TableCell> : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </>
  );
}
