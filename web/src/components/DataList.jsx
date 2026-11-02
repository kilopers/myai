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
 * actions(row) → элементы действий в конце.
 */
export default function DataList({ columns, rows, actions, empty = 'Нет записей' }) {
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
          <Card key={row.id} variant="outlined" sx={{ borderRadius: 2 }}>
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
      {/* десктоп — таблица */}
      <Box sx={{ display: { xs: 'none', sm: 'block' }, overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              {columns.map((c) => (
                <TableCell key={c.key} align={c.align}>{c.label}</TableCell>
              ))}
              {actions ? <TableCell /> : null}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} hover>
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
