param(
    [Parameter(Mandatory = $true)][string]$SourceDocx,
    [Parameter(Mandatory = $true)][string]$ReferencesDocx,
    [Parameter(Mandatory = $true)][string]$OutputJson,
    [string]$TabTitle = 'تمهيد ومقدمة'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Read-WordParagraphs {
    param([string]$Path)

    $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $entry = $zip.GetEntry('word/document.xml')
        if (-not $entry) { throw "word/document.xml was not found in $Path" }

        $reader = [System.IO.StreamReader]::new($entry.Open())
        try { [xml]$xml = $reader.ReadToEnd() } finally { $reader.Dispose() }

        $ns = [System.Xml.XmlNamespaceManager]::new($xml.NameTable)
        $ns.AddNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')

        $result = @()
        foreach ($paragraph in $xml.SelectNodes('//w:body/w:p', $ns)) {
            $text = (($paragraph.SelectNodes('.//w:t', $ns) | ForEach-Object { $_.InnerText }) -join '').Trim()
            if (-not $text) { continue }

            $styleNode = $paragraph.SelectSingleNode('./w:pPr/w:pStyle', $ns)
            $style = if ($styleNode) {
                $styleNode.GetAttribute('val', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')
            } else {
                ''
            }

            $result += [pscustomobject]@{
                Text   = $text
                Style  = $style
                IsList = [bool]$paragraph.SelectSingleNode('./w:pPr/w:numPr', $ns)
            }
        }

        return $result
    }
    finally {
        $zip.Dispose()
    }
}

$sourceParagraphs = @(Read-WordParagraphs -Path $SourceDocx)
$referenceParagraphs = @(Read-WordParagraphs -Path $ReferencesDocx)

$body = [System.Collections.ArrayList]::new()
$listItems = @()

foreach ($paragraph in $sourceParagraphs) {
    if ($paragraph.IsList) {
        $listItems += $paragraph.Text
        continue
    }

    if ($listItems.Count -gt 0) {
        [void]$body.Add([ordered]@{ type = 'doc-list'; items = @($listItems) })
        $listItems = @()
    }

    if ($paragraph.Style -match '^Heading([1-4])$') {
        [void]$body.Add([ordered]@{
            type  = 'doc-heading'
            level = [int]$Matches[1]
            text  = $paragraph.Text
        })
    }
    elseif ($paragraph.Style -eq 'BlockText') {
        [void]$body.Add([ordered]@{ type = 'doc-quote'; text = $paragraph.Text })
    }
    else {
        [void]$body.Add([ordered]@{ type = 'doc-paragraph'; text = $paragraph.Text })
    }
}

if ($listItems.Count -gt 0) {
    [void]$body.Add([ordered]@{ type = 'doc-list'; items = @($listItems) })
}

function Convert-ToTableRow {
    param([string]$Text)
    $separatorIndex = $Text.IndexOf(':')
    if ($separatorIndex -lt 0) { throw "A table row has no separator: $Text" }
    return [ordered]@{
        label = $Text.Substring(0, $separatorIndex)
        value = $Text.Substring($separatorIndex + 1).TrimStart()
    }
}

$formattedBody = [System.Collections.ArrayList]::new()
for ($index = 0; $index -lt $body.Count; $index++) {
    $item = $body[$index]
    $text = if ($item['type'] -eq 'doc-paragraph') { [string]$item['text'] } else { '' }

    if ($text.StartsWith('ومن بين الآفات التي أحدثت تحولًا جذريًا')) {
        [void]$formattedBody.Add([ordered]@{
            type = 'doc-callout'
            tone = 'amber'
            icon = 'fas fa-bug'
            text = $text
        })
        continue
    }

    if ($text.StartsWith('وتُعرف هذه الظاهرة أحيانًا باسم الجسر الأخضر')) {
        [void]$formattedBody.Add([ordered]@{
            type = 'doc-callout'
            tone = 'danger'
            icon = 'fas fa-triangle-exclamation'
            text = $text
        })
        continue
    }

    if ($text.StartsWith('الإنتاج للسوق الطازج:') -and $index + 1 -lt $body.Count) {
        $nextText = [string]$body[$index + 1]['text']
        if ($body[$index + 1]['type'] -eq 'doc-paragraph' -and $nextText.StartsWith('الإنتاج للتصنيع:')) {
            [void]$formattedBody.Add([ordered]@{
                type = 'doc-table'
                rows = @((Convert-ToTableRow $text), (Convert-ToTableRow $nextText))
            })
            $index++
            continue
        }
    }

    if ($text.StartsWith('الإصابة (Infestation):') -and $index + 2 -lt $body.Count) {
        $secondText = [string]$body[$index + 1]['text']
        $thirdText = [string]$body[$index + 2]['text']
        if ($body[$index + 1]['type'] -eq 'doc-paragraph' -and
            $body[$index + 2]['type'] -eq 'doc-paragraph' -and
            $secondText.StartsWith('الضرر (Damage):') -and
            $thirdText.StartsWith('الخسارة الاقتصادية (Economic Loss):')) {
            [void]$formattedBody.Add([ordered]@{
                type = 'doc-table'
                rows = @(
                    (Convert-ToTableRow $text),
                    (Convert-ToTableRow $secondText),
                    (Convert-ToTableRow $thirdText)
                )
            })
            $index += 2
            continue
        }
    }

    [void]$formattedBody.Add($item)
}

$body = $formattedBody

$shortReferences = @($referenceParagraphs | Select-Object -Last 7)
$referenceOrder = @(0, 1, 3, 6, 2, 4, 5)
$references = @()

for ($number = 1; $number -le $referenceOrder.Count; $number++) {
    $line = $shortReferences[$referenceOrder[$number - 1]].Text
    $urlMatch = [regex]::Match($line, 'https?://\S+')
    if (-not $urlMatch.Success) { throw "No URL found in reference: $line" }

    $references += [ordered]@{
        number = $number
        text   = $line.Substring(0, $urlMatch.Index).TrimEnd()
        url    = $urlMatch.Value
    }
}

[void]$body.Add([ordered]@{
    type  = 'doc-heading'
    level = 1
    text  = 'المراجع'
    id    = 'chapter-one-references'
})
[void]$body.Add([ordered]@{ type = 'reference-list'; items = $references })

$chapter = [ordered]@{
    id             = 'tuta'
    chapter_number = 'آفات حشرية | طماطم'
    chapter_title  = 'توتا أبسولوتا (Tuta absoluta)'
    tabs           = @(
        [ordered]@{
            tab_title     = $TabTitle
            content_blocks = @(
                [ordered]@{
                    type  = 'doc-article'
                    items = @($body)
                    meta  = [ordered]@{
                        updated_at = '2026-06-19'
                    }
                }
            )
        }
    )
}

$json = $chapter | ConvertTo-Json -Depth 12 -Compress
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($OutputJson, $json + [Environment]::NewLine, $utf8NoBom)

Write-Output "Imported $($sourceParagraphs.Count) source paragraphs and $($references.Count) linked references into $OutputJson"
