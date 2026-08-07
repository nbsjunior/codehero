      *****************************************************************
      * CONCILIACAO DIARIA — exemplo de integridade de dado.
      *
      * Nao ha aqui nenhum erro de sintaxe, nenhum SQLCODE ignorado e
      * nenhum cursor vazando. O programa compila, roda e passa em
      * teste com volume pequeno.
      *
      * Os defeitos sao todos de CABIMENTO, e nenhum deles gera erro:
      *
      *   1. valor de 9 digitos movido para campo de 4
      *   2. texto movido para campo numerico
      *   3. coluna que aceita nulo lida sem indicador
      *   4. cursor declarado e nunca aberto
      *
      * O primeiro e o pior: o COBOL corta os digitos da FRENTE, entao
      * 125.000.000 vira 5.000. A conciliacao fecha com diferenca e
      * ninguem liga a diferenca a este programa.
      *****************************************************************
       IDENTIFICATION DIVISION.
       PROGRAM-ID. CONCILIA.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-VLR-APURADO          PIC 9(9)V99.
       01  WS-VLR-RESUMO           PIC 9(4)V99.
       01  WS-COD-TEXTO            PIC X(10).
       01  WS-COD-NUMERICO         PIC 9(10).
       01  WS-DESCRICAO            PIC X(40).
       01  WS-TOTAL                PIC S9(11)V99 COMP-3.
       01  SQLCODE                 PIC S9(9) COMP.

       PROCEDURE DIVISION.

       MAIN-PARA.
           PERFORM CARREGA
           PERFORM RESUME-VALORES
           STOP RUN.

       CARREGA.
      *    DESCRICAO nao tem NOT NULL: pode vir nula e devolver -305.
           EXEC SQL
             DECLARE T-LANC TABLE
               (ID INTEGER NOT NULL,
                VALOR DECIMAL(11,2) NOT NULL,
                DESCRICAO VARCHAR(40))
           END-EXEC.

      *    Cursor declarado numa manutencao antiga e nunca aberto.
           EXEC SQL
             DECLARE C-ANTIGO CURSOR FOR
               SELECT ID FROM T-LANC WHERE VALOR > 0
           END-EXEC.

           EXEC SQL
             SELECT DESCRICAO INTO :WS-DESCRICAO FROM T-LANC
              WHERE ID = 1
           END-EXEC.
           IF SQLCODE NOT = ZERO
             DISPLAY 'FALHA NA LEITURA ' SQLCODE
           END-IF.

       RESUME-VALORES.
      *    O campo de resumo tem 4 digitos inteiros e a origem tem 9.
      *    O COBOL corta os digitos MAIS significativos: 125000000,00
      *    chega como 5000,00 e a conciliacao fecha errado.
           MOVE WS-VLR-APURADO TO WS-VLR-RESUMO.

      *    Texto indo para campo numerico. Se WS-COD-TEXTO trouxer
      *    espaco ou letra, o resultado depende do compilador.
           MOVE WS-COD-TEXTO TO WS-COD-NUMERICO.

           ADD WS-VLR-RESUMO TO WS-TOTAL.
           DISPLAY 'TOTAL CONCILIADO: ' WS-TOTAL.
